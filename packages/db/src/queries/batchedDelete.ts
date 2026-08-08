/**
 * One batched, timeout-tolerant delete loop, shared by every sweep.
 *
 * Extracted when privacy retention became the second and third caller of the loop that
 * `purgeExpiredPromotions` had grown. The SQL stays at the call site; only the pacing
 * lives here, because the pacing is the part that was hard to get right.
 *
 * Batched rather than one statement: a single transaction deleting millions of rows on a
 * db-g1-small both holds locks and floods WAL. Each batch commits on its own, so a timeout
 * or a restart loses nothing and the next run continues where this one stopped.
 *
 * A timed-out DELETE rolls back whole, so nothing is half-deleted and a smaller retry is
 * safe. Without the backoff a single slow batch throws, the non-fatal caller logs it, and
 * the sweep makes no progress tonight or any other night: a permanently failing job whose
 * error nobody reads.
 */
export const PURGE_BATCH_MAX = 20_000;
export const PURGE_BATCH_MIN = 500;
/** Postgres `query_canceled`, which is what statement_timeout raises. */
const STATEMENT_TIMEOUT = "57014";
/** Enough attempts to clear ~800k at the smallest batch, plus room to back off. */
const MAX_BATCHES = 2_000;

export interface BatchedDeleteResult {
  deleted: number;
  /** Completed iterations, including ones abandoned to a timeout backoff. */
  batches: number;
  /** Where the backoff ended up, so a caller can log that batches were shrunk. */
  batchSize: number;
  /** True when MAX_BATCHES stopped the sweep with rows still to go. */
  capped: boolean;
}

function isStatementTimeout(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === STATEMENT_TIMEOUT
  );
}

/**
 * Run `deleteBatch` until it reports nothing left, halving-and-then-some on timeout.
 *
 * `deleteBatch` receives the row limit for this attempt and returns how many it removed.
 * Anything but a timeout propagates: it is a real fault and belongs to the caller. At the
 * floor a timeout propagates too, because a batch of 500 that cannot finish means something
 * is wrong with the database rather than with the batch size, and grinding on would hide it.
 */
export async function deleteInBatches(
  deleteBatch: (limit: number) => Promise<number>,
): Promise<BatchedDeleteResult> {
  let deleted = 0;
  let batches = 0;
  let batchSize = PURGE_BATCH_MAX;
  for (; batches < MAX_BATCHES; batches += 1) {
    let removed: number;
    try {
      removed = await deleteBatch(batchSize);
    } catch (err) {
      if (!isStatementTimeout(err) || batchSize <= PURGE_BATCH_MIN) throw err;
      batchSize = Math.max(PURGE_BATCH_MIN, Math.floor(batchSize / 4));
      continue;
    }
    deleted += removed;
    if (removed === 0) return { deleted, batches, batchSize, capped: false };
  }
  return { deleted, batches, batchSize, capped: true };
}
