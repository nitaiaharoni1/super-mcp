import type { FeedFile, SourceAdapter } from "@super-mcp/shared";
import { isTransientIngestionError } from "../transient.js";
import { normalizeRecords } from "./normalize.js";
import { parseFeedFile } from "./parse.js";
import { MAX_TRANSIENT_FILE_ATTEMPTS } from "./types.js";

export interface FileProcessStats {
  ok: number;
  err: number;
  processed: boolean;
  fatal?: string;
  promoOther?: number;
  unitUnparseable?: number;
  regionFiltered?: number;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 250));
}

export async function processFeedFile(
  adapter: SourceAdapter,
  file: FeedFile,
  archiveRoot: string,
): Promise<FileProcessStats> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_FILE_ATTEMPTS; attempt++) {
    try {
      const parsed = await parseFeedFile(adapter, file, archiveRoot);
      const stats = await normalizeRecords(adapter.sourceId, parsed.records);
      return {
        ok: stats.rowsOk,
        err: stats.rowsError,
        processed: true,
        promoOther: stats.promoOther,
        unitUnparseable: stats.unitUnparseable,
        regionFiltered: stats.regionFiltered,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_TRANSIENT_FILE_ATTEMPTS || !isTransientIngestionError(msg)) {
        return { ok: 0, err: 1, processed: false, fatal: msg };
      }
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          event: "ingestion_file_retry",
          sourceId: adapter.sourceId,
          file: file.fileName,
          attempt,
          error: msg,
        }),
      );
      await retryDelay(attempt);
    }
  }
  return { ok: 0, err: 1, processed: false, fatal: "retry attempts exhausted" };
}
