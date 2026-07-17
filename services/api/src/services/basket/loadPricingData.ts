import { query } from "@super-mcp/db";
import { getActivePromotionsForListings } from "../promotions/index.js";
import type { ListingRow, StorePriceRow } from "./types.js";

export interface BasketPricingContext {
  listingByChainAndProduct: Map<string, Map<string, ListingRow>>;
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
  const listingByChainAndProduct = new Map<string, Map<string, ListingRow>>();
  for (const listing of listingRes.rows) {
    const byProduct = listingByChainAndProduct.get(listing.chain_id) ?? new Map<string, ListingRow>();
    byProduct.set(listing.product_id, listing);
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
