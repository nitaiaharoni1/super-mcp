import { query, sqlNormalizeGtin } from "@super-mcp/db";
import { applyPromoToUnitPrice, type PromoMechanicType, type RawPromoRecord } from "@super-mcp/shared";

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
       AND ($2::boolean IS TRUE OR pr.club_only = false)
     -- Stable ordering so map insertion order is deterministic regardless of
     -- Postgres row order; pickBestPromoForStore still picks by price, this is
     -- only a defensive tie-break for equal-effective promos.
     ORDER BY pr.promo_code, pr.store_id NULLS LAST`,
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
    // The item_code join can fan the same promo onto a listing multiple times;
    // collapse to one candidate per (promo_code, store_id).
    if (!list.some((c) => c.promoCode === candidate.promoCode && c.storeId === candidate.storeId)) {
      list.push(candidate);
    }
    map.set(row.listing_id, list);
  }
  return map;
}

/** A promo choice with its computed effective total for a given list price and quantity. */
export interface PickedPromo {
  candidate: PromoCandidate;
  effectiveTotal: number;
}

/**
 * Picks the promo that yields the LOWEST effective total for this store — what a
 * shopper actually pays at checkout — instead of the first store-specific row in
 * arbitrary DB order. Eligible = store-specific for THIS store, or chain-wide
 * (store_id IS NULL) for this chain. Only promos that actually apply and reduce
 * the price below list are considered. Deterministic: ties break by promo_code asc.
 */
export function pickBestPromoForStore(
  candidates: PromoCandidate[] | undefined,
  storeId: string,
  chainId: string,
  listPrice: number,
  qty: number,
): PickedPromo | null {
  if (!candidates || candidates.length === 0) return null;
  const baseline = listPrice * qty;
  let best: PickedPromo | null = null;

  for (const candidate of candidates) {
    const eligible =
      candidate.storeId === storeId || (candidate.storeId === null && candidate.chainId === chainId);
    if (!eligible) continue;

    const applied = applyPromoToUnitPrice(listPrice, qty, candidate.mechanic);
    if (!applied.applied || applied.effectiveTotal >= baseline) continue;

    if (
      best === null ||
      applied.effectiveTotal < best.effectiveTotal ||
      (applied.effectiveTotal === best.effectiveTotal &&
        candidate.promoCode < best.candidate.promoCode)
    ) {
      best = { candidate, effectiveTotal: applied.effectiveTotal };
    }
  }
  return best;
}
