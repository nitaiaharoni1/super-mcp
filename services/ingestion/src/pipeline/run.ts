import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceAdapter } from "@super-mcp/shared";
import { fileConcurrency, mapPool } from "@super-mcp/shared";
import { emitAlert } from "./alert.js";
import { drainSemanticAfterIngest } from "./enrich.js";
import { finishRun, reapStaleRuns, startRun } from "./persist.js";
import { processFeedFile, type FileProcessStats } from "./processFile.js";
import { classifyStatus, isAlertable } from "./status.js";
import type { PipelineResult } from "./types.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function absorb(result: PipelineResult, stats: FileProcessStats): void {
  result.rowsOk += stats.ok;
  result.rowsError += stats.err;
  if (stats.processed) result.filesProcessed++;
  if (stats.fatal) {
    result.errorSummary = (result.errorSummary ? result.errorSummary + "; " : "") + stats.fatal;
  }
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

    for (const file of storeFiles) {
      absorb(result, await processFeedFile(adapter, file, archiveRoot));
    }

    const priceOutcomes = await mapPool(priceFiles, concurrency, async (file) => {
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
      return stats;
    });

    for (const stats of priceOutcomes) absorb(result, stats);

    result.status = classifyStatus(result);
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
