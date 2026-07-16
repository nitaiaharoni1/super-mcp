import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceAdapter } from "@super-mcp/shared";
import { getPool } from "@super-mcp/db";
import { archiveBlob } from "./archive.js";
import { Normalizer } from "./normalize.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface PipelineResult {
  sourceId: string;
  status: "success" | "failed" | "empty" | "degraded";
  filesDiscovered: number;
  filesProcessed: number;
  /** PriceFull/PromoFull files selected at discover time; 0 means metadata-only. */
  priceFilesDiscovered: number;
  rowsOk: number;
  rowsError: number;
  errorSummary?: string;
}

// A run whose rows are mostly errors parsed but produced garbage: surface it as
// degraded rather than success so alerting (SPEC P0 #10) fires within one cycle.
const DEGRADED_ERROR_RATIO = 0.5;
// Whole-file fetch/parse failures only bump rowsError by 1 each; treat a large
// fraction of undiscovered→unprocessed files as degraded even when row ratios look green.
const DEGRADED_FILE_FAILURE_RATIO = 0.3;

/** True for any terminal status an operator should be alerted about. */
export function isAlertable(status: PipelineResult["status"]): boolean {
  return status === "failed" || status === "empty" || status === "degraded";
}

/**
 * Emits a single-line structured ERROR that Cloud Logging can turn into a
 * log-based metric + alert policy. Keeping it one line and machine-parseable is
 * what makes SPEC P0 #10 ("failed/empty adapter run alerts within one cycle")
 * satisfiable without extra infrastructure.
 */
function emitAlert(runId: string, result: PipelineResult): void {
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "ingestion_run_failed",
      sourceId: result.sourceId,
      runId,
      status: result.status,
      filesDiscovered: result.filesDiscovered,
      filesProcessed: result.filesProcessed,
      rowsOk: result.rowsOk,
      rowsError: result.rowsError,
      errorSummary: result.errorSummary ?? null,
    }).replace(/\u0000/g, ""),
  );
}

export async function runPipeline(adapter: SourceAdapter): Promise<PipelineResult> {
  const pool = getPool();
  const archiveRoot = process.env.RAW_ARCHIVE_DIR
    ? path.resolve(rootDir, process.env.RAW_ARCHIVE_DIR)
    : path.join(rootDir, "data/raw");

  // Reap this source's rows still stuck in 'running' from a prior crash/OOM that
  // never reached finishRun; left alone they look in-progress to health checks
  // forever instead of failed. Best-effort: a blip here must not abort the cycle
  // for this adapter or subsequent adapters in --source=all.
  try {
    await pool.query(
      `UPDATE ingestion_run
         SET status = 'failed', finished_at = now(), error_summary = 'reaped: stale running row'
       WHERE source_id = $1 AND status = 'running' AND started_at < now() - interval '6 hours'`,
      [adapter.sourceId],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        severity: "WARNING",
        event: "ingestion_reap_failed",
        sourceId: adapter.sourceId,
        error: msg,
      }).replace(/\u0000/g, ""),
    );
  }

  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_run (source_id, status) VALUES ($1, 'running') RETURNING id`,
    [adapter.sourceId],
  );
  const runId = runRes.rows[0]!.id;

  const result: PipelineResult = {
    sourceId: adapter.sourceId,
    status: "success",
    filesDiscovered: 0,
    priceFilesDiscovered: 0,
    filesProcessed: 0,
    rowsOk: 0,
    rowsError: 0,
  };

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

    const normalizer = new Normalizer(adapter.sourceId);

    for (const file of files) {
      try {
        const blob = await adapter.fetch(file);
        const archivePath = await archiveBlob(blob, archiveRoot);
        blob.archivePath = archivePath;

        // NOTE: parse() is not a streaming parser today. fetch() buffers the whole
        // file and fast-xml-parser builds a full document, so peak memory is
        // bytes + decoded string + DOM + record array. apply() consumes records
        // one at a time so DB writes don't buffer further. A SAX/streaming parser
        // is the known fix if large PriceFull files OOM a small Cloud Run Job.
        const stats = await normalizer.apply(adapter.parse(blob));
        result.rowsOk += stats.rowsOk;
        result.rowsError += stats.rowsError;
        result.filesProcessed++;
      } catch (err) {
        result.rowsError++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errorSummary = (result.errorSummary ? result.errorSummary + "; " : "") + msg;
      }
    }

    result.status = classifyStatus(result);
    if (result.status === "degraded" && result.priceFilesDiscovered === 0) {
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") +
        "no price/promo files selected (stores feed failed or region matched no stores)";
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

/**
 * Terminal status from run counters. A run with rows_ok > 0 is only 'success'
 * when errors are a minority and most discovered files were processed; a mostly-
 * failing feed (schema drift, corrupt encoding, flaky FTP for many stores)
 * becomes 'degraded' so it alerts instead of silently reporting green.
 * All rows errored -> 'failed'; files processed but genuinely no rows -> 'empty'.
 */
export function classifyStatus(result: PipelineResult): PipelineResult["status"] {
  if (result.filesProcessed === 0) return "failed";
  if (result.rowsOk === 0) return result.rowsError > 0 ? "failed" : "empty";

  // Rows landed but no price/promo files were even selected (e.g. Stores XML
  // failed and the region filter matched nothing): metadata-only, not green.
  if (result.priceFilesDiscovered === 0) return "degraded";

  if (result.filesDiscovered > 0) {
    const fileFailureRatio =
      (result.filesDiscovered - result.filesProcessed) / result.filesDiscovered;
    if (fileFailureRatio > DEGRADED_FILE_FAILURE_RATIO) return "degraded";
  }

  const errorRatio = result.rowsError / (result.rowsOk + result.rowsError || 1);
  if (errorRatio > DEGRADED_ERROR_RATIO) return "degraded";
  return "success";
}

async function finishRun(runId: string, result: PipelineResult): Promise<void> {
  const summary = result.errorSummary?.replace(/\u0000/g, "") ?? null;
  await getPool().query(
    `UPDATE ingestion_run SET
       finished_at = now(),
       status = $2,
       files_discovered = $3,
       files_processed = $4,
       rows_ok = $5,
       rows_error = $6,
       error_summary = $7,
       report = $8::jsonb
     WHERE id = $1`,
    [
      runId,
      result.status,
      result.filesDiscovered,
      result.filesProcessed,
      result.rowsOk,
      result.rowsError,
      summary,
      JSON.stringify(result).replace(/\u0000/g, ""),
    ],
  );
}
