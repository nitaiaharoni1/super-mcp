import { query } from "@super-mcp/db";
import type { PromoMechanicType, RawPromoRecord } from "@super-mcp/shared";

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
           JOIN listing l2 ON l2.id = pi2.listing_id
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

export interface PromoCandidate {
  listingId: string;
  storeId: string | null;
  chainId: string;
  promoCode: string;
  description: string;
  mechanic: RawPromoRecord["mechanic"];
}

/** Loads currently-active promotions covering the given listings, keyed by listing id. */
export async function getActivePromotionsForListings(
  listingIds: string[],
  includeClub: boolean,
): Promise<Map<string, PromoCandidate[]>> {
  const map = new Map<string, PromoCandidate[]>();
  if (listingIds.length === 0) return map;

  const res = await query<{
    listing_id: string;
    store_id: string | null;
    chain_id: string;
    promo_code: string;
    description: string;
    mechanic_type: PromoMechanicType;
    mechanic_params: Record<string, unknown>;
  }>(
    `SELECT pi.listing_id, pr.store_id, pr.chain_id, pr.promo_code, pr.description,
            pr.mechanic_type, pr.mechanic_params
     FROM promotion pr
     JOIN promotion_item pi ON pi.promotion_id = pr.id
     WHERE pi.listing_id = ANY($1::uuid[])
       AND pr.start_ts <= now() AND pr.end_ts >= now()
       AND ($2::boolean IS TRUE OR pr.club_only = false)`,
    [listingIds, includeClub],
  );

  for (const row of res.rows) {
    const candidate: PromoCandidate = {
      listingId: row.listing_id,
      storeId: row.store_id,
      chainId: row.chain_id,
      promoCode: row.promo_code,
      description: row.description,
      mechanic: {
        type: row.mechanic_type,
        params: row.mechanic_params as RawPromoRecord["mechanic"]["params"],
      },
    };
    const list = map.get(row.listing_id) ?? [];
    list.push(candidate);
    map.set(row.listing_id, list);
  }
  return map;
}

/** Prefers a store-specific promo over a chain-wide one (store_id IS NULL) for the same listing. */
export function pickPromoForStore(
  candidates: PromoCandidate[] | undefined,
  storeId: string,
  chainId: string,
): PromoCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  const storeSpecific = candidates.find((c) => c.storeId === storeId);
  if (storeSpecific) return storeSpecific;
  const chainWide = candidates.find((c) => c.storeId === null && c.chainId === chainId);
  return chainWide ?? null;
}
