import { scrubNullChars } from "@super-mcp/shared";
import { getPool } from "@super-mcp/db";
import type { PipelineResult } from "./types.js";

export async function reapStaleRuns(sourceId: string): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `UPDATE ingestion_run
         SET status = 'failed', finished_at = now(), error_summary = 'reaped: stale running row'
       WHERE source_id = $1 AND status = 'running' AND started_at < now() - interval '6 hours'`,
      [sourceId],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      scrubNullChars(
        JSON.stringify({
          severity: "WARNING",
          event: "ingestion_reap_failed",
          sourceId,
          error: msg,
        }),
      ),
    );
  }
}

export async function startRun(sourceId: string): Promise<string> {
  const runRes = await getPool().query<{ id: string }>(
    `INSERT INTO ingestion_run (source_id, status) VALUES ($1, 'running') RETURNING id`,
    [sourceId],
  );
  return runRes.rows[0]!.id;
}

export async function finishRun(runId: string, result: PipelineResult): Promise<void> {
  const summary = result.errorSummary ? scrubNullChars(result.errorSummary) : null;
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
      scrubNullChars(JSON.stringify(result)),
    ],
  );
}
