import { query } from "@super-mcp/db";
import type { PromoMechanicType } from "@super-mcp/shared";

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
}

export async function listPromotions(params: ListPromotionsParams): Promise<PromotionSummary[]> {
  const res = await query<PromotionRow>(
    `SELECT
       pr.id, pr.chain_id, c.name_he AS chain_name, pr.store_id, pr.store_code, pr.promo_code,
       pr.description, pr.mechanic_type, pr.mechanic_params, pr.club_only,
       pr.start_ts, pr.end_ts, pr.source_ts, pr.ingested_at,
       array_remove(array_agg(pi.item_code), NULL) AS item_codes
     FROM promotion pr
     JOIN chain c ON c.id = pr.chain_id
     LEFT JOIN promotion_item pi ON pi.promotion_id = pr.id
     WHERE ($1::uuid IS NULL OR pr.store_id = $1)
       AND (
         $2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM promotion_item pi2
           JOIN listing l2 ON l2.chain_id = pr.chain_id
             AND l2.item_code <> ''
             AND (l2.item_code = pi2.item_code OR l2.item_code = regexp_replace(pi2.item_code, '\D', '', 'g'))
           WHERE pi2.promotion_id = pr.id AND l2.product_id = $2
         )
       )
       AND (
         $3::boolean IS NULL
         OR ($3 IS TRUE AND pr.start_ts <= now() AND pr.end_ts >= now())
         OR ($3 IS FALSE AND (pr.start_ts > now() OR pr.end_ts < now()))
       )
     GROUP BY pr.id, c.name_he
     ORDER BY pr.start_ts DESC
     LIMIT 200`,
    [params.storeId ?? null, params.productId ?? null, params.activeOnly ?? null],
  );
  return res.rows.map(mapPromotion);
}
