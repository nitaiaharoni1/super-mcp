import { query } from "@super-mcp/db";
import { getActivePromotionsForListings } from "../promotions/index.js";
import type { CandidateAvailability, ListingRow, StorePriceRow } from "./types.js";

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
    `SELECT l.id, l.product_id, l.chain_id, l.item_code, l.name, p.gtin,
            l.is_weighted, l.sale_basis, l.piece_count
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
 * Batch local availability for confirmation options: priced store count, chain
 * diversity, and minimum nearby price. Missing ids are absent from the map.
 */
export async function loadCandidateAvailability(
  productIds: string[],
  storeIds: string[],
): Promise<Map<string, CandidateAvailability>> {
  if (productIds.length === 0 || storeIds.length === 0) return new Map();
  const result = await query<{
    product_id: string;
    priced_stores: string | number;
    priced_chains: string | number;
    min_price: string | number | null;
  }>(
    `SELECT l.product_id,
            count(DISTINCT sp.store_id) AS priced_stores,
            count(DISTINCT l.chain_id) AS priced_chains,
            min(sp.price) AS min_price
       FROM listing l
       JOIN store_price sp ON sp.listing_id = l.id
      WHERE l.product_id = ANY($1::uuid[])
        AND sp.store_id = ANY($2::uuid[])
        AND sp.price > 0
      GROUP BY l.product_id`,
    [productIds, storeIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.product_id,
      {
        pricedStoreCount: Number(row.priced_stores),
        chainCount: Number(row.priced_chains),
        minPrice: row.min_price == null ? null : Number(row.min_price),
      },
    ]),
  );
}
