import { getPool } from "../client/index.js";
import { deleteInBatches, type BatchedDeleteResult } from "./batchedDelete.js";

/**
 * Privacy retention sweeps: the two tables that accumulate something about a caller.
 *
 * Both are opt-in via an env var and both run from the nightly ingest job, alongside the
 * promotion purge. Nothing here runs unless an operator sets a window, because a sweep that
 * deletes production data on a default nobody chose is worse than no sweep.
 *
 * `access_requests` is deliberately NOT swept. Those rows are people who asked for access,
 * the privacy policy says they are kept until deletion is requested, and expiring a lead on
 * a timer would destroy the record rather than protect anyone.
 */

export interface RetentionSweepResult extends BatchedDeleteResult {
  retentionDays: number;
}

/**
 * Drop usage rows older than the window.
 *
 * These carry no content at all: api_key_id, route, status_code, latency_ms, created_at.
 * They are swept anyway because "how long do you keep anything" deserves a real answer, and
 * because a per-request table on a nightly-ingested catalogue is the one that grows without
 * bound.
 */
export async function purgeOldUsageEvents(retentionDays: number): Promise<RetentionSweepResult> {
  const result = await deleteInBatches(async (limit) => {
    const res = await getPool().query(
      `WITH doomed AS (
         SELECT id FROM usage_event
          WHERE created_at < now() - ($1 || ' days')::interval
          ORDER BY created_at
          LIMIT $2
       )
       DELETE FROM usage_event u USING doomed d WHERE u.id = d.id`,
      [String(retentionDays), limit],
    );
    return res.rowCount ?? 0;
  });
  return { ...result, retentionDays };
}

/**
 * Age out cached search phrases.
 *
 * This is the privacy-meaningful one. `semantic_query_embedding` stores `normalized_query`,
 * the phrase a shopper actually typed, and without a sweep it stays forever. No row names a
 * caller and no row links to another, so nobody's list can be reassembled from it, but "we
 * keep the words indefinitely" is not something a privacy page should have to say.
 *
 * Ages on `embedded_at`, which a cache HIT deliberately does not refresh (only `hits` moves).
 * So every phrase expires on a fixed clock no matter how popular it is, and a phrase still in
 * use simply costs one re-embed and starts a new clock. That is the right trade for a cache:
 * correctness is unaffected, and the alternative, a last-used timestamp, would keep a
 * frequently searched phrase on file forever.
 */
export async function purgeIdleQueryEmbeddings(idleDays: number): Promise<RetentionSweepResult> {
  const result = await deleteInBatches(async (limit) => {
    const res = await getPool().query(
      `WITH doomed AS (
         SELECT query_hash, model FROM semantic_query_embedding
          WHERE embedded_at < now() - ($1 || ' days')::interval
          ORDER BY embedded_at
          LIMIT $2
       )
       DELETE FROM semantic_query_embedding s
        USING doomed d
        WHERE s.query_hash = d.query_hash AND s.model = d.model`,
      [String(idleDays), limit],
    );
    return res.rowCount ?? 0;
  });
  return { ...result, retentionDays: idleDays };
}
