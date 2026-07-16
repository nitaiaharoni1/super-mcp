import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceAdapter } from "@super-mcp/shared";
import { getPool } from "@super-mcp/db";
import { archiveBlob } from "./archive.js";
import { Normalizer } from "./normalize.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface PipelineResult {
  sourceId: string;
  status: "success" | "failed" | "empty";
  filesDiscovered: number;
  filesProcessed: number;
  rowsOk: number;
  rowsError: number;
  errorSummary?: string;
}

export async function runPipeline(adapter: SourceAdapter): Promise<PipelineResult> {
  const pool = getPool();
  const archiveRoot = process.env.RAW_ARCHIVE_DIR
    ? path.resolve(rootDir, process.env.RAW_ARCHIVE_DIR)
    : path.join(rootDir, "data/raw");

  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_run (source_id, status) VALUES ($1, 'running') RETURNING id`,
    [adapter.sourceId],
  );
  const runId = runRes.rows[0]!.id;

  const result: PipelineResult = {
    sourceId: adapter.sourceId,
    status: "success",
    filesDiscovered: 0,
    filesProcessed: 0,
    rowsOk: 0,
    rowsError: 0,
  };

  try {
    const files = await adapter.discover();
    result.filesDiscovered = files.length;
    if (files.length === 0) {
      result.status = "empty";
      await finishRun(runId, result);
      return result;
    }

    const normalizer = new Normalizer(adapter.sourceId);

    for (const file of files) {
      try {
        const blob = await adapter.fetch(file);
        const archivePath = await archiveBlob(blob, archiveRoot);
        blob.archivePath = archivePath;

        const records: import("@super-mcp/shared").RawRecord[] = [];
        for await (const rec of adapter.parse(blob)) {
          records.push(rec);
        }
        const stats = await normalizer.apply(records);
        result.rowsOk += stats.rowsOk;
        result.rowsError += stats.rowsError;
        result.filesProcessed++;
      } catch (err) {
        result.rowsError++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errorSummary = (result.errorSummary ? result.errorSummary + "; " : "") + msg;
      }
    }

    if (result.rowsOk > 0) {
      result.status = "success";
    } else if (result.filesProcessed === 0) {
      result.status = "failed";
    } else {
      result.status = "empty";
    }

    await finishRun(runId, result);
    return result;
  } catch (err) {
    result.status = result.rowsOk > 0 ? "success" : "failed";
    result.errorSummary = (err instanceof Error ? err.message : String(err)).replace(
      /\u0000/g,
      "",
    );
    await finishRun(runId, result);
    return result;
  }
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
