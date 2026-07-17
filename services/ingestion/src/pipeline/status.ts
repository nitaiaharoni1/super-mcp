import { DEGRADED_ERROR_RATIO, type PipelineResult } from "./types.js";

/** True for any terminal status an operator should be alerted about. */
export function isAlertable(status: PipelineResult["status"]): boolean {
  return status === "failed" || status === "empty" || status === "degraded";
}

/**
 * Terminal status from run counters. A run with rows_ok > 0 is only 'success'
 * when errors are a minority and most discovered files were processed.
 */
export function classifyStatus(result: PipelineResult): PipelineResult["status"] {
  if (result.filesProcessed === 0) return "failed";
  if (result.rowsOk === 0) return result.rowsError > 0 ? "failed" : "empty";

  if (result.priceFilesDiscovered === 0) return "degraded";

  // A file we discovered but failed to process is lost data; never report success.
  if (result.filesProcessed < result.filesDiscovered) return "degraded";

  const errorRatio = result.rowsError / (result.rowsOk + result.rowsError || 1);
  if (errorRatio > DEGRADED_ERROR_RATIO) return "degraded";
  return "success";
}
