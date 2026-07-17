import { query, sqlNormalizeGtin } from "@super-mcp/db";
import type { PromoMechanicType, RawPromoRecord } from "@super-mcp/shared";

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
    // Join through listing.item_code at read time rather than trusting promotion_item.listing_id
    // (which can be NULL forever if the promo file ingested before the price file, and can
    // mismatch on raw-vs-normalized-GTIN item codes). Matches either the raw code or
    // normalizeGtin(item_code), since GTIN listings store item_code = normalizeGtin(...).
    // l.item_code <> '' guards against a promo item_code with zero digits fanning onto
    // every listing that happens to have an empty item_code.
    `SELECT l.id AS listing_id, pr.store_id, pr.chain_id, pr.promo_code, pr.description,
            pr.mechanic_type, pr.mechanic_params
     FROM promotion pr
     JOIN promotion_item pi ON pi.promotion_id = pr.id
     JOIN listing l ON l.chain_id = pr.chain_id
       AND l.item_code <> ''
       AND (
         l.item_code = pi.item_code
         OR (pi.item_code_norm IS NOT NULL AND pi.item_code_norm <> '' AND l.item_code = pi.item_code_norm)
         OR l.item_code = ${sqlNormalizeGtin("pi.item_code")}
       )
     WHERE l.id = ANY($1::uuid[])
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
