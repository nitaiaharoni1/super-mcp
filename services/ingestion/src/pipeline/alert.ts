import { scrubNullChars } from "@super-mcp/shared";
import type { PipelineResult } from "./types.js";

export function emitAlert(runId: string, result: PipelineResult): void {
  console.error(
    scrubNullChars(
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
      }),
    ),
  );
}
