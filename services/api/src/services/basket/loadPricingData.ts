import { query } from "@super-mcp/db";
import { getActivePromotionsForListings } from "../promotions/index.js";
import type { ListingRow, StorePriceRow } from "./types.js";

export interface BasketPricingContext {
  listingByChainAndProduct: Map<string, Map<string, ListingRow[]>>;
  priceByListingAndStore: Map<string, StorePriceRow>;
  promoMap: Awaited<ReturnType<typeof getActivePromotionsForListings>>;
}

export async function loadBasketPricingData(
  productIds: string[],
  storeIds: string[],
  includeClub: boolean,
): Promise<BasketPricingContext> {
  const listingRes = await query<ListingRow>(
    `SELECT l.id, l.product_id, l.chain_id, l.item_code, l.name, p.gtin
     FROM listing l JOIN product p ON p.id = l.product_id
     WHERE l.product_id = ANY($1::uuid[])`,
    [productIds],
  );
  const listingByChainAndProduct = new Map<string, Map<string, ListingRow[]>>();
  for (const listing of listingRes.rows) {
    const byProduct =
      listingByChainAndProduct.get(listing.chain_id) ?? new Map<string, ListingRow[]>();
    const rows = byProduct.get(listing.product_id) ?? [];
    rows.push(listing);
    byProduct.set(listing.product_id, rows);
    listingByChainAndProduct.set(listing.chain_id, byProduct);
  }

  const listingIds = listingRes.rows.map((l) => l.id);
  const priceRes =
    listingIds.length > 0
      ? await query<StorePriceRow>(
          `SELECT listing_id, store_id, price, currency, source_ts, ingested_at
           FROM store_price
           WHERE listing_id = ANY($1::uuid[])
             AND store_id = ANY($2::uuid[])
             AND price > 0`,
          [listingIds, storeIds],
        )
      : { rows: [] as StorePriceRow[] };
  const priceByListingAndStore = new Map<string, StorePriceRow>();
  for (const row of priceRes.rows) {
    priceByListingAndStore.set(`${row.listing_id}:${row.store_id}`, row);
  }

  const promoMap = await getActivePromotionsForListings(listingIds, includeClub);

  return { listingByChainAndProduct, priceByListingAndStore, promoMap };
}

/**
 * How many distinct location-scoped stores carry a positive price for each of the
 * given product ids. One aggregate over all ids (not per product) so a prepared
 * basket can report REAL nearby availability per option instead of a fabricated
 * flag. Returns a Map keyed by product id; ids with no priced store are absent.
 */
export async function countNearbyPricedStores(
  productIds: string[],
  storeIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (productIds.length === 0 || storeIds.length === 0) return counts;
  const res = await query<{ product_id: string; priced_stores: string | number }>(
    `SELECT l.product_id, count(DISTINCT sp.store_id) AS priced_stores
     FROM listing l JOIN store_price sp ON sp.listing_id = l.id
     WHERE l.product_id = ANY($1::uuid[])
       AND sp.store_id = ANY($2::uuid[])
       AND sp.price > 0
     GROUP BY l.product_id`,
    [productIds, storeIds],
  );
  for (const row of res.rows) {
    counts.set(row.product_id, Number(row.priced_stores));
  }
  return counts;
}
