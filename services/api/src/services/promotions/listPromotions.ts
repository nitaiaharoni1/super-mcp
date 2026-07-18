import { query } from "@super-mcp/db";
import { cityMatchKeys, type PromoMechanicType } from "@super-mcp/shared";

export interface PromotionSummary {
  id: string;
  chainId: string;
  chainName: string;
  storeId: string | null;
  storeCode: string | null;
  promoCode: string;
  description: string;
  mechanicType: PromoMechanicType;
  mechanicParams: Record<string, unknown>;
  clubOnly: boolean;
  startTs: string;
  endTs: string;
  sourceTs: string;
  ingestedAt: string;
  itemCodes: string[];
}

interface PromotionRow {
  id: string;
  chain_id: string;
  chain_name: string;
  store_id: string | null;
  store_code: string | null;
  promo_code: string;
  description: string;
  mechanic_type: PromoMechanicType;
  mechanic_params: Record<string, unknown>;
  club_only: boolean;
  start_ts: string;
  end_ts: string;
  source_ts: string;
  ingested_at: string;
  item_codes: string[] | null;
}

function mapPromotion(row: PromotionRow): PromotionSummary {
  return {
    id: row.id,
    chainId: row.chain_id,
    chainName: row.chain_name,
    storeId: row.store_id,
    storeCode: row.store_code,
    promoCode: row.promo_code,
    description: row.description,
    mechanicType: row.mechanic_type,
    mechanicParams: row.mechanic_params,
    clubOnly: row.club_only,
    startTs: row.start_ts,
    endTs: row.end_ts,
    sourceTs: row.source_ts,
    ingestedAt: row.ingested_at,
    itemCodes: row.item_codes ?? [],
  };
}

export interface ListPromotionsParams {
  storeId?: string;
  productId?: string;
  activeOnly?: boolean;
  /** City to scope promotions to (store-specific in that city, or chain-wide of chains present there). */
  city?: string;
  /** Max promotions to return. Defaults to 50, clamped to 1..200. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

export async function listPromotions(params: ListPromotionsParams): Promise<PromotionSummary[]> {
  const limit = clampLimit(params.limit);
  const cityKeys = params.city ? cityMatchKeys(params.city) : null;

  // Two-phase: pick the limited set of promotion ids FIRST (no item_code aggregation),
  // then aggregate item_codes only for that page. This keeps the aggregation from
  // fanning out over every promotion before the LIMIT applies.
  const res = await query<PromotionRow>(
    `WITH page AS (
       SELECT pr.id
       FROM promotion pr
       WHERE ($1::uuid IS NULL
          OR pr.store_id = $1
          OR (pr.store_id IS NULL
              AND pr.chain_id = (SELECT chain_id FROM store WHERE id = $1)))
         AND (
           $2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM promotion_item pi2
             JOIN listing l2 ON l2.chain_id = pr.chain_id
               AND l2.item_code <> ''
               AND (l2.item_code = pi2.item_code OR l2.item_code = regexp_replace(pi2.item_code, '\\D', '', 'g'))
             WHERE pi2.promotion_id = pr.id AND l2.product_id = $2
           )
         )
         AND (
           $3::boolean IS NULL
           OR ($3 IS TRUE AND pr.start_ts <= now() AND pr.end_ts >= now())
           OR ($3 IS FALSE AND (pr.start_ts > now() OR pr.end_ts < now()))
         )
         AND (
           $4::text[] IS NULL
           OR EXISTS (
             SELECT 1 FROM store s
             WHERE s.city = ANY($4::text[])
               AND (pr.store_id = s.id OR (pr.store_id IS NULL AND s.chain_id = pr.chain_id))
           )
         )
       ORDER BY pr.end_ts ASC, pr.id
       LIMIT $5
     )
     SELECT
       pr.id, pr.chain_id, c.name_he AS chain_name, pr.store_id, pr.store_code, pr.promo_code,
       pr.description, pr.mechanic_type, pr.mechanic_params, pr.club_only,
       pr.start_ts, pr.end_ts, pr.source_ts, pr.ingested_at,
       array_remove(array_agg(pi.item_code), NULL) AS item_codes
     FROM page
     JOIN promotion pr ON pr.id = page.id
     JOIN chain c ON c.id = pr.chain_id
     LEFT JOIN promotion_item pi ON pi.promotion_id = pr.id
     GROUP BY pr.id, c.name_he
     ORDER BY pr.end_ts ASC, pr.id`,
    [
      params.storeId ?? null,
      params.productId ?? null,
      params.activeOnly ?? null,
      cityKeys,
      limit,
    ],
  );
  return res.rows.map(mapPromotion);
}
