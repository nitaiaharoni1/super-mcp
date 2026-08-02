import type { PoolClient } from "pg";
import { getPool, withTransaction } from "../client/index.js";
import { sqlNormalizeGtin } from "../schema/gtinSql.js";

export interface UpsertPromoInput {
  chainId: string;
  storeId: string | null;
  storeCode: string;
  promoCode: string;
  description: string;
  mechanicType: string;
  mechanicParams: Record<string, unknown>;
  rawText?: string;
  clubOnly: boolean;
  startTs: Date;
  endTs: Date;
  sourceTs: Date;
  itemCodes: string[];
}

async function upsertPromotionOn(
  q: PoolClient | ReturnType<typeof getPool>,
  input: UpsertPromoInput,
): Promise<string> {
  const res = await q.query<{ id: string }>(
    `INSERT INTO promotion (
       chain_id, store_id, store_code, promo_code, description,
       mechanic_type, mechanic_params, raw_text, club_only,
       start_ts, end_ts, source_ts, ingested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (chain_id, store_code, promo_code) DO UPDATE SET
       store_id = COALESCE(EXCLUDED.store_id, promotion.store_id),
       description = EXCLUDED.description,
       mechanic_type = EXCLUDED.mechanic_type,
       mechanic_params = EXCLUDED.mechanic_params,
       raw_text = EXCLUDED.raw_text,
       club_only = EXCLUDED.club_only,
       start_ts = EXCLUDED.start_ts,
       end_ts = EXCLUDED.end_ts,
       source_ts = EXCLUDED.source_ts,
       ingested_at = now()
     RETURNING id`,
    [
      input.chainId,
      input.storeId,
      input.storeCode,
      input.promoCode,
      input.description,
      input.mechanicType,
      JSON.stringify(input.mechanicParams),
      input.rawText ?? null,
      input.clubOnly,
      input.startTs,
      input.endTs,
      input.sourceTs,
    ],
  );
  const promoId = res.rows[0]!.id;
  await q.query(`DELETE FROM promotion_item WHERE promotion_id = $1`, [promoId]);
  if (input.itemCodes.length > 0) {
    // One round-trip: resolve listing_ids and insert all promo items.
    // item_code_norm mirrors normalizeGtin (gate on post-strip length).
    const normExpr = sqlNormalizeGtin("c.code");
    await q.query(
      `INSERT INTO promotion_item (promotion_id, item_code, item_code_norm, listing_id)
       SELECT $1::uuid,
              c.code,
              ${normExpr},
              l.id
       FROM unnest($2::text[]) AS c(code)
       LEFT JOIN listing l ON l.chain_id = $3
         AND l.item_code <> ''
         AND (l.item_code = c.code OR l.item_code = ${normExpr})
       ON CONFLICT DO NOTHING`,
      [promoId, input.itemCodes, input.chainId],
    );
  }
  return promoId;
}

export async function upsertPromotion(input: UpsertPromoInput, client?: PoolClient): Promise<string> {
  // Delete+insert of promotion_item must be atomic so a failed insert cannot
  // leave a promo with zero items until the next successful ingest.
  if (client) return upsertPromotionOn(client, input);
  return withTransaction((tx) => upsertPromotionOn(tx, input));
}

export interface ExpiredPromoPurgeResult {
  /** Promotions removed. Their items go with them via ON DELETE CASCADE. */
  promotionsDeleted: number;
  /** Batches attempted, including ones a timeout sent back smaller. */
  batches: number;
  /** Batch size the sweep settled on; below the maximum means it backed off. */
  batchSize: number;
  retentionDays: number;
  /** True when the cap stopped it early, so the sweep did not finish. */
  capped: boolean;
}

/**
 * Days a finished promotion stays queryable before it is swept.
 *
 * Israeli supermarket promotions run weekly, so roughly 800,000 expire every
 * week and `promotion_item` was the single largest table in the database at
 * 2.75GB of 6.37GB, larger than every price row put together. Two weeks keeps
 * "what was on offer last week" answerable through `get_promotions`
 * (active_only=false is the only reader) and still clears the bulk.
 */
const DEFAULT_PROMO_RETENTION_DAYS = 14;

/**
 * Batch size: small enough that a weak instance never holds a long lock.
 *
 * Starts high and backs off, because the pool pins `statement_timeout=30000`
 * and one batch is not 20,000 row deletions but closer to 126,000: the average
 * promotion carries about five `promotion_item` rows, and the cascade has to
 * maintain four indexes on `promotion` and three on `promotion_item`. Thirty
 * seconds is probably enough for that on a db-g1-small and definitely enough
 * once the backlog is gone, but "probably" is a poor bet for the FIRST sweep,
 * which is the big one and the one whose failure would be least expected.
 *
 * A timed-out DELETE rolls back whole, so nothing is half-deleted and a smaller
 * retry is safe. Without the backoff a single slow batch throws, the non-fatal
 * hook logs it, and the sweep makes no progress on that night or any other:
 * a permanently failing job whose error nobody reads.
 */
const PURGE_BATCH_MAX = 20_000;
const PURGE_BATCH_MIN = 500;
/** Postgres `query_canceled`, which is what statement_timeout raises. */
const STATEMENT_TIMEOUT = "57014";
/** Enough attempts to clear ~800k at the smallest batch, plus room to back off. */
const MAX_BATCHES = 2_000;

function isStatementTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === STATEMENT_TIMEOUT
  );
}

/**
 * Delete promotions that ended more than `retentionDays` ago.
 *
 * Batched rather than one statement, because the first sweep removes millions of
 * `promotion_item` rows and a single transaction of that size on a db-g1-small
 * both holds locks and floods WAL. Each batch commits on its own, so a timeout
 * or a restart loses nothing and the next run simply continues.
 *
 * Worth being explicit about what this does NOT do: it will not reduce the bill.
 * Cloud SQL charges for the PROVISIONED disk, and that disk cannot shrink. What
 * it buys is a smaller working set, so the queries and the nightly ingest stop
 * paying for three weeks of dead rows.
 */
export async function purgeExpiredPromotions(
  retentionDays: number = DEFAULT_PROMO_RETENTION_DAYS,
): Promise<ExpiredPromoPurgeResult> {
  let promotionsDeleted = 0;
  let batches = 0;
  let batchSize = PURGE_BATCH_MAX;
  for (; batches < MAX_BATCHES; batches += 1) {
    let removed: number;
    try {
      const res = await getPool().query(
        `WITH doomed AS (
           SELECT id FROM promotion
            WHERE end_ts < now() - ($1 || ' days')::interval
            ORDER BY end_ts
            LIMIT $2
         )
         DELETE FROM promotion p USING doomed d WHERE p.id = d.id`,
        [String(retentionDays), batchSize],
      );
      removed = res.rowCount ?? 0;
    } catch (err) {
      // Anything but the timeout is a real fault and belongs to the caller. At
      // the floor, so is the timeout: a batch of 500 that cannot finish in
      // thirty seconds means something is wrong with the database, not with
      // the batch size, and quietly grinding on would hide it.
      if (!isStatementTimeout(err) || batchSize <= PURGE_BATCH_MIN) throw err;
      batchSize = Math.max(PURGE_BATCH_MIN, Math.floor(batchSize / 4));
      continue;
    }
    promotionsDeleted += removed;
    if (removed === 0) {
      return { promotionsDeleted, batches, batchSize, retentionDays, capped: false };
    }
  }
  return { promotionsDeleted, batches, batchSize, retentionDays, capped: true };
}
