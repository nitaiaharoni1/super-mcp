import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";

/**
 * Delisting reconciliation for `store_price`.
 *
 * The price table is upsert-only, so a row survives forever once written. When a
 * chain stops carrying an item the row keeps its last known price, which inflates
 * that store's basket coverage and lets it "price" something it has not stocked
 * in months — the store then wins a cheapest-basket comparison on stale data.
 *
 * A chain's `PriceFull` file is a complete shelf snapshot for one store, so any
 * row for that store not refreshed while the file was being ingested is no longer
 * on the shelf. `last_seen_at` (always bumped on upsert, unlike the monotonically
 * gated `source_ts`) is the cutoff basis.
 *
 * Safety is deliberately biased towards keeping stale rows over deleting live
 * ones: a truncated download or a partially-parsed file must never empty a store.
 * Callers gate on file kind (full only) and error-free processing; this function
 * additionally refuses to act when the delete would remove an implausible share
 * of the store's catalog.
 */

/** Refuse to delete more than this fraction of a store's rows in one pass. */
export const MAX_RECONCILE_DELETE_RATIO = 0.35;

/** Below this many rows seen, a full file is too small to trust as a snapshot. */
export const MIN_RECONCILE_SEEN_ROWS = 50;

export interface ReconcileStorePricesInput {
  storeId: string;
  /**
   * Start of the ingest window for this store's full file. Rows whose
   * `last_seen_at` is older than this were absent from the snapshot.
   */
  seenSince: Date;
  /** Rows the caller actually wrote from this file (plausibility check). */
  rowsSeen: number;
  maxDeleteRatio?: number;
  minSeenRows?: number;
}

export type ReconcileSkipReason =
  | "too_few_rows_seen"
  | "delete_ratio_exceeded"
  | "nothing_stale";

export interface ReconcileStorePricesResult {
  deleted: number;
  /** Total rows the store had before reconciling. */
  totalBefore: number;
  /** Rows that looked stale (absent from the snapshot). */
  staleFound: number;
  skipped: ReconcileSkipReason | null;
}

/**
 * Delete this store's `store_price` rows that a just-ingested full snapshot did
 * not refresh. Returns counts and, when it declines to act, why.
 */
export async function reconcileStorePrices(
  input: ReconcileStorePricesInput,
  client?: PoolClient,
): Promise<ReconcileStorePricesResult> {
  const q = client ?? getPool();
  const maxRatio = input.maxDeleteRatio ?? MAX_RECONCILE_DELETE_RATIO;
  const minSeen = input.minSeenRows ?? MIN_RECONCILE_SEEN_ROWS;

  const counts = await q.query<{ total_before: string; stale_found: string }>(
    `SELECT count(*) AS total_before,
            count(*) FILTER (
              WHERE last_seen_at IS NULL OR last_seen_at < $2
            ) AS stale_found
       FROM store_price
      WHERE store_id = $1`,
    [input.storeId, input.seenSince],
  );
  const totalBefore = Number(counts.rows[0]?.total_before ?? 0);
  const staleFound = Number(counts.rows[0]?.stale_found ?? 0);

  const base: ReconcileStorePricesResult = {
    deleted: 0,
    totalBefore,
    staleFound,
    skipped: null,
  };

  if (staleFound === 0) return { ...base, skipped: "nothing_stale" };

  // A full file that yielded almost nothing is far more likely truncated than a
  // store that genuinely delisted its whole catalog.
  if (input.rowsSeen < minSeen) return { ...base, skipped: "too_few_rows_seen" };

  if (totalBefore > 0 && staleFound / totalBefore > maxRatio) {
    return { ...base, skipped: "delete_ratio_exceeded" };
  }

  const del = await q.query(
    `DELETE FROM store_price
      WHERE store_id = $1
        AND (last_seen_at IS NULL OR last_seen_at < $2)`,
    [input.storeId, input.seenSince],
  );

  return { ...base, deleted: del.rowCount ?? 0 };
}
