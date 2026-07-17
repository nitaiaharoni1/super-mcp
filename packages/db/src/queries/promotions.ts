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
