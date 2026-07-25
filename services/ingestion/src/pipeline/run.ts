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
 * all" (discovery yielded none) and "files but no usable rows" so the alert
 * names the actual failure mode.
 */
function findEmptyChains(
  adapter: SourceAdapter,
  discoveredChainIds: Set<string>,
  rowsByChain: Map<string, number>,
): { chainsWithNoFiles: string[]; chainsWithNoRows: string[] } {
  // The adapter is authoritative when it can say what it attempted; the
  // per-source fallback covers adapters that cannot.
  const expected = adapter.expectedChainIds ?? expectedChainIdsForSource(adapter.sourceId);
  const chainsWithNoFiles = expected.filter((id) => !discoveredChainIds.has(id));
  const chainsWithNoRows = expected.filter(
    (id) => discoveredChainIds.has(id) && (rowsByChain.get(id) ?? 0) === 0,
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
    result.priceFilesDiscovered = files.filter(
      (f) => f.kind === "pricesfull" || f.kind === "promosfull",
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

    // Per-chain row tally so a chain that yields nothing can't hide behind the
    // healthy chains' totals.
    const rowsByChain = new Map<string, number>();
    const noteChainRows = (chainId: string, rows: number): void => {
      rowsByChain.set(chainId, (rowsByChain.get(chainId) ?? 0) + rows);
    };
    for (const file of files) if (!rowsByChain.has(file.chainId)) rowsByChain.set(file.chainId, 0);

    const failedStoreChains = new Set<string>();
    for (const file of storeFiles) {
      const stats = await processFeedFile(adapter, file, archiveRoot);
      if (stats.fatal) failedStoreChains.add(file.chainId);
      noteChainRows(file.chainId, stats.ok);
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
    result.errorSummary = (err instanceof Error ? err.message : String(err)).replace(
      /\u0000/g,
      "",
    );
    result.status = classifyStatus(result);
    await finishRun(runId, result);
    if (isAlertable(result.status)) emitAlert(runId, result);
    return result;
  }
}
