import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceAdapter } from "@super-mcp/shared";
import { fileConcurrency, mapPool } from "@super-mcp/shared";
import { getPool } from "@super-mcp/db";
import { activeStoreCap, coverageMode } from "../ingestCaps.js";
import { emitAlert } from "./alert.js";
import { drainSemanticAfterIngest } from "./enrich.js";
import { finishRun, reapStaleRuns, startRun } from "./persist.js";
import { processFeedFile, type FileProcessStats } from "./processFile.js";
import { classifyStatus, isAlertable } from "./status.js";
import type { PipelineResult } from "./types.js";
import { expectedChainIdsForSource } from "../expectedChains.js";
import { chainsWithNoStorefront } from "../storeHints.js";

/**
 * An error message that names what actually went wrong.
 *
 * Node's `fetch` throws a bare `TypeError: fetch failed` and hides the real
 * reason (ENOTFOUND, ETIMEDOUT, a TLS failure, a refused connection) one level
 * down in `cause`. A nightly job that reports only "fetch failed" cannot be
 * diagnosed without reproducing it, and the first production run of the
 * laibcatalog source failed exactly that way.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cause instanceof Error && depth < 4) {
    const code = (cause as { code?: string }).code;
    parts.push(code ? `${cause.message} (${code})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
    depth += 1;
  }
  return parts.join(": ");
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Store count above which a capped run is treated as a misconfiguration rather
 * than a smoke test. A local fixture DB holds a handful of stores; anything past
 * this is a real catalog that a 2-store-per-chain run would leave stale.
 */
const CAPPED_RUN_STORE_ALARM = 50;

/** Once per process: the caps are process-wide, so one warning carries the signal. */
let cappedRunWarned = false;

/** Stores currently in the database, for the capped-run warning. 0 on any error. */
async function countStores(): Promise<number> {
  try {
    const { rows } = await getPool().query<{ n: string }>("SELECT count(*) AS n FROM store");
    return Number(rows[0]?.n ?? 0);
  } catch {
    // Reporting must never break an ingest.
    return 0;
  }
}

function absorb(result: PipelineResult, stats: FileProcessStats): void {
  result.rowsOk += stats.ok;
  result.rowsError += stats.err;
  result.promoOtherRows += stats.promoOther ?? 0;
  result.unitUnparseableRows += stats.unitUnparseable ?? 0;
  result.regionFilteredStores += stats.regionFiltered ?? 0;
  result.storeCityFromName += stats.storeCityFromName ?? 0;
  result.pricesReconciled += stats.pricesReconciled ?? 0;
  if (stats.processed) result.filesProcessed++;
  if (stats.fatal) {
    result.errorSummary = (result.errorSummary ? result.errorSummary + "; " : "") + stats.fatal;
  }
}

/**
 * Chains we expected data from that produced nothing. Split into "no files at
 * all" (discovery yielded none) and "files but no usable PRICE rows" so the
 * alert names the actual failure mode.
 *
 * The second case is the common one and the easiest to miss: a chain whose FTP
 * answers well enough to hand over its Stores file, then times out on every
 * price file, looks alive from every angle except the only one that matters.
 */
function findEmptyChains(
  adapter: SourceAdapter,
  discoveredChainIds: Set<string>,
  rowsByChain: Map<string, number>,
): { chainsWithNoFiles: string[]; chainsWithNoRows: string[] } {
  // The adapter is authoritative when it can say what it attempted; the
  // per-source fallback covers adapters that cannot.
  const expected = adapter.expectedChainIds ?? expectedChainIdsForSource(adapter.sourceId);
  const priceExempt = new Set([
    ...(adapter.priceExemptChainIds ?? []),
    // Discovered, not configured: under the online filter a chain with no
    // storefront has nothing to price, and eight of the sixteen we hold are in
    // that position. Leaving them in would mark a healthy run `degraded` nightly.
    ...chainsWithNoStorefront(),
  ]);
  const chainsWithNoFiles = expected.filter((id) => !discoveredChainIds.has(id));
  // A chain that publishes stores and no prices is exempt only where that is the
  // PUBLISHED reality, never by default: the whole point of this gate is that
  // Osher Ad looked healthy while its prices went a fortnight stale.
  const chainsWithNoRows = expected.filter(
    (id) =>
      !priceExempt.has(id) &&
      discoveredChainIds.has(id) &&
      (rowsByChain.get(id) ?? 0) === 0,
  );
  return { chainsWithNoFiles, chainsWithNoRows };
}

export async function runPipeline(adapter: SourceAdapter): Promise<PipelineResult> {
  const archiveRoot = process.env.RAW_ARCHIVE_DIR
    ? path.resolve(rootDir, process.env.RAW_ARCHIVE_DIR)
    : path.join(rootDir, "data/raw");

  await reapStaleRuns(adapter.sourceId);
  const runId = await startRun(adapter.sourceId);

  const result: PipelineResult = {
    sourceId: adapter.sourceId,
    status: "success",
    filesDiscovered: 0,
    priceFilesDiscovered: 0,
    filesProcessed: 0,
    rowsOk: 0,
    rowsError: 0,
    promoOtherRows: 0,
    unitUnparseableRows: 0,
    regionFilteredStores: 0,
    storeCityFromName: 0,
    pricesReconciled: 0,
    chainsWithNoFiles: [],
    chainsWithNoRows: [],
    coverageMode: coverageMode(),
    storeCap: activeStoreCap(),
  };

  // A capped run against a database that already holds a full catalog is almost
  // always a misconfiguration, not a smoke test. Warn loudly with the numbers so
  // it cannot pass for a healthy national ingest the way it did in production.
  if (result.coverageMode === "capped_smoke" && !cappedRunWarned) {
    cappedRunWarned = true;
    const storeCount = await countStores();
    console.error(
      JSON.stringify({
        severity: storeCount > CAPPED_RUN_STORE_ALARM ? "WARNING" : "INFO",
        event: "ingestion_capped_run",
        sourceId: adapter.sourceId,
        coverageMode: result.coverageMode,
        storeCap: result.storeCap,
        storesInDatabase: storeCount,
        hint: "Set SUPER_MCP_NO_CAP=1 (or SUPER_MCP_FULL=1) for a full ingest. Without it only the first 2 Cerberus chains and 2 stores per chain are refreshed.",
      }),
    );
  }

  try {
    const files = await adapter.discover();
    result.filesDiscovered = files.length;
    // Any file that carries prices counts, not just full snapshots.
    //
    // The check asks "did this run find anything priced at all", and a source
    // that publishes incremental files answers yes. Counting only the *full
    // variants marked every such run `degraded` with "no price/promo files
    // selected" while it was in fact writing thousands of rows without a single
    // error, which is an alert that fires on healthy runs and therefore trains
    // people to ignore it. The online sources hit this first because a Wolt
    // category page and a stor.ai search result are genuinely partial, but the
    // regulated `Price`/`Promo` files have always been in the same position.
    result.priceFilesDiscovered = files.filter(
      (f) =>
        f.kind === "pricesfull" ||
        f.kind === "promosfull" ||
        f.kind === "prices" ||
        f.kind === "promos",
    ).length;
    if (files.length === 0) {
      result.status = "empty";
      await finishRun(runId, result);
      emitAlert(runId, result);
      return result;
    }

    const storeFiles = files.filter((f) => f.kind === "stores");
    const priceFiles = files.filter((f) => f.kind !== "stores");
    const concurrency = fileConcurrency();
    console.log(
      JSON.stringify({
        event: "ingestion_process_start",
        sourceId: adapter.sourceId,
        storeFiles: storeFiles.length,
        priceFiles: priceFiles.length,
        concurrency,
      }),
    );

    // Per-chain PRICE row tally so a chain that yields nothing can't hide behind
    // the healthy chains' totals.
    //
    // Prices only, deliberately. Counting store rows here made the gate blind to
    // the failure it exists for: Osher Ad published its Stores file and not one
    // price file on 2026-08-02, and because its 24 store rows landed, the chain
    // both appeared in `discoveredChainIds` and had a non-zero tally. The run
    // reported no empty chains while that chain's prices stayed a fortnight
    // stale. A chain's store list is metadata; the prices are the coverage.
    const rowsByChain = new Map<string, number>();
    const noteChainRows = (chainId: string, rows: number): void => {
      rowsByChain.set(chainId, (rowsByChain.get(chainId) ?? 0) + rows);
    };
    for (const file of files) if (!rowsByChain.has(file.chainId)) rowsByChain.set(file.chainId, 0);

    const failedStoreChains = new Set<string>();
    for (const file of storeFiles) {
      const stats = await processFeedFile(adapter, file, archiveRoot);
      if (stats.fatal) failedStoreChains.add(file.chainId);
      absorb(result, stats);
    }

    // Skip price/promo files only for chains whose stores feed failed: their
    // region filtering and store identity are unreliable, so ingesting prices
    // would attach them to stub stores nationwide. Healthy chains still ingest.
    // Skipped files leave filesProcessed < filesDiscovered, so classifyStatus
    // marks the run degraded (or failed if every chain's stores feed failed).
    const safePriceFiles = failedStoreChains.size
      ? priceFiles.filter((f) => !failedStoreChains.has(f.chainId))
      : priceFiles;
    const skippedForBadStores = priceFiles.length - safePriceFiles.length;
    if (skippedForBadStores > 0) {
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") +
        `${skippedForBadStores} price/promo file(s) skipped: stores feed failed for chain(s) ${[...failedStoreChains].join(", ")}`;
    }

    const priceOutcomes = await mapPool(safePriceFiles, concurrency, async (file) => {
      const stats = await processFeedFile(adapter, file, archiveRoot);
      console.log(
        JSON.stringify({
          event: "ingestion_file_done",
          sourceId: adapter.sourceId,
          file: file.fileName,
          kind: file.kind,
          storeId: file.storeId ?? null,
          rowsOk: stats.ok,
          rowsError: stats.err,
          error: stats.fatal ?? null,
        }),
      );
      return { file, stats };
    });

    for (const { file, stats } of priceOutcomes) {
      noteChainRows(file.chainId, stats.ok);
      absorb(result, stats);
    }

    const empties = findEmptyChains(
      adapter,
      new Set(files.map((f) => f.chainId)),
      rowsByChain,
    );
    result.chainsWithNoFiles = empties.chainsWithNoFiles;
    result.chainsWithNoRows = empties.chainsWithNoRows;
    if (empties.chainsWithNoFiles.length > 0 || empties.chainsWithNoRows.length > 0) {
      const parts: string[] = [];
      if (empties.chainsWithNoFiles.length > 0) {
        parts.push(`no files from chain(s) ${empties.chainsWithNoFiles.join(", ")}`);
      }
      if (empties.chainsWithNoRows.length > 0) {
        parts.push(`no rows from chain(s) ${empties.chainsWithNoRows.join(", ")}`);
      }
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") + parts.join("; ");
    }

    result.status = classifyStatus(result);
    console.log(
      JSON.stringify({
        event: "ingestion_quality",
        sourceId: adapter.sourceId,
        promoOtherRows: result.promoOtherRows,
        unitUnparseableRows: result.unitUnparseableRows,
        regionFilteredStores: result.regionFilteredStores,
        storeCityFromName: result.storeCityFromName,
        pricesReconciled: result.pricesReconciled,
        chainsWithNoFiles: result.chainsWithNoFiles,
        chainsWithNoRows: result.chainsWithNoRows,
      }),
    );
    if (result.status === "degraded" && result.priceFilesDiscovered === 0) {
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") +
        "no price/promo files selected (stores feed failed or region matched no stores)";
    }

    if (result.rowsOk > 0 && (result.status === "success" || result.status === "degraded")) {
      await drainSemanticAfterIngest(result);
    }

    await finishRun(runId, result);
    if (isAlertable(result.status)) emitAlert(runId, result);
    return result;
  } catch (err) {
    result.errorSummary = describeError(err).replace(/\u0000/g, "");
    // A source that died before discovering anything produced NO files for any
    // chain it was supposed to cover, and saying so is the whole job of this
    // field. It used to stay empty on a fatal error, so a run that reached the
    // portal and got nothing reported `chainsWithNoFiles: []` next to its own
    // error, which reads as "every expected chain delivered".
    if (result.filesDiscovered === 0) {
      result.chainsWithNoFiles =
        adapter.expectedChainIds ?? expectedChainIdsForSource(adapter.sourceId);
    }
    result.status = classifyStatus(result);
    await finishRun(runId, result);
    if (isAlertable(result.status)) emitAlert(runId, result);
    return result;
  }
}
