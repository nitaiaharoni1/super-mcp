import { reconcileStorePrices, type ReconcileSkipReason } from "@super-mcp/db";
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
  storeCityFromName?: number;
  /** store_price rows deleted because a full snapshot no longer listed them. */
  pricesReconciled?: number;
  /** Stores where reconciliation declined to act, by reason (telemetry). */
  reconcileSkips?: Partial<Record<ReconcileSkipReason, number>>;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 250));
}

/**
 * A `PriceFull` file is a complete shelf snapshot for one store, so rows it did
 * not refresh are delisted. A delta `Price` file is NOT — reconciling from one
 * would delete most of the store's catalog.
 */
function isFullPriceSnapshot(file: FeedFile): boolean {
  return file.kind === "pricesfull";
}

/**
 * Drop this store's price rows that the just-ingested full snapshot did not
 * refresh. Never runs on a delta file, never on a file that reported an error,
 * and reconcileStorePrices applies its own plausibility gates on top.
 */
async function reconcileAfterFullSnapshot(
  file: FeedFile,
  pricesByStore: Map<string, number>,
  seenSince: Date,
): Promise<{ deleted: number; skips: Partial<Record<ReconcileSkipReason, number>> }> {
  const skips: Partial<Record<ReconcileSkipReason, number>> = {};
  let deleted = 0;

  for (const [storeId, rowsSeen] of pricesByStore) {
    try {
      const outcome = await reconcileStorePrices({ storeId, seenSince, rowsSeen });
      deleted += outcome.deleted;
      if (outcome.skipped) skips[outcome.skipped] = (skips[outcome.skipped] ?? 0) + 1;
      if (outcome.deleted > 0 || (outcome.skipped && outcome.skipped !== "nothing_stale")) {
        console.log(
          JSON.stringify({
            event: "ingestion_price_reconcile",
            file: file.fileName,
            chainId: file.chainId,
            storeId,
            rowsSeen,
            deleted: outcome.deleted,
            staleFound: outcome.staleFound,
            totalBefore: outcome.totalBefore,
            skipped: outcome.skipped,
          }),
        );
      }
    } catch (err) {
      // Reconciliation is hygiene, never a reason to fail an ingested file.
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          event: "ingestion_price_reconcile_failed",
          file: file.fileName,
          storeId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return { deleted, skips };
}

export async function processFeedFile(
  adapter: SourceAdapter,
  file: FeedFile,
  archiveRoot: string,
): Promise<FileProcessStats> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_FILE_ATTEMPTS; attempt++) {
    // Captured before any row is written so a row refreshed by THIS file always
    // has last_seen_at >= the cutoff, even across a slow multi-minute file.
    const seenSince = new Date();
    try {
      const parsed = await parseFeedFile(adapter, file, archiveRoot);
      const stats = await normalizeRecords(adapter.sourceId, parsed.records);

      let pricesReconciled = 0;
      let reconcileSkips: Partial<Record<ReconcileSkipReason, number>> | undefined;
      // Only a clean full snapshot may delete: a file that errored may have
      // dropped rows we would then misread as delisted.
      if (isFullPriceSnapshot(file) && stats.rowsError === 0 && stats.pricesByStore.size > 0) {
        const outcome = await reconcileAfterFullSnapshot(file, stats.pricesByStore, seenSince);
        pricesReconciled = outcome.deleted;
        reconcileSkips = outcome.skips;
      }

      return {
        ok: stats.rowsOk,
        err: stats.rowsError,
        processed: true,
        promoOther: stats.promoOther,
        unitUnparseable: stats.unitUnparseable,
        regionFiltered: stats.regionFiltered,
        storeCityFromName: stats.storeCityFromName,
        pricesReconciled,
        reconcileSkips,
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
