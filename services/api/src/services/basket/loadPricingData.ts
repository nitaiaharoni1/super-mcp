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
  includeCoupon = true,
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

  const promoMap = await getActivePromotionsForListings(listingIds, includeClub, includeCoupon);

  return { listingByChainAndProduct, priceByListingAndStore, promoMap };
}

/**
 * How long the per-store feed date is reused before the aggregate runs again.
 *
 * The answer moves once a night, when an ingest lands. The query behind it is a
 * `max(source_ts) GROUP BY store_id`, which no index can serve — `source_ts` is
 * indexed, but not alongside `store_id` — so the planner reads every price row.
 * Measured at 99ms against production. Small next to a basket call, and pure
 * waste to repeat per request for a number that changes daily.
 */
const FEED_DATE_TTL_MS = 5 * 60_000;

let feedDateCache: { byStore: Map<string, Date>; expiresAt: number } | null = null;
/** Collapses concurrent callers onto one scan instead of one scan each. */
let feedDateInflight: Promise<Map<string, Date>> | null = null;

/** Test-only: drop the cached feed dates and any in-flight scan. */
export function _resetStoreFeedDatesForTests(): void {
  feedDateCache = null;
  feedDateInflight = null;
}

/**
 * When each store's retailer last published price data, by store id.
 *
 * This is the honest answer to "how old are these prices", and a per-line
 * `source_ts` is not. Chains stamp that field two different ways: Tiv Taam,
 * Shufersal and Carrefour write the file's own date onto every row, while Rami
 * Levy and Keshet write the date each item's price last CHANGED. Both republish
 * the whole shelf nightly, and `reconcileStorePrices` deletes anything missing
 * from the newest snapshot, so a surviving row is in the current file whatever
 * its timestamp says.
 *
 * Counting old per-line timestamps therefore measured the chain's stamping
 * convention, not its data: it branded 99% of Keshet's lines stale off a
 * three-day-old feed, and passed Machsanei Hashuk clean while its feed had been
 * frozen since 29/07. The newest timestamp the store has is the one that says
 * when the retailer last spoke.
 *
 * A failure here returns an empty map rather than throwing. Freshness annotates
 * a basket; it must never be the reason a shopper gets no answer.
 */
export async function loadStoreFeedDates(now: Date): Promise<Map<string, Date>> {
  if (feedDateCache && feedDateCache.expiresAt > now.getTime()) return feedDateCache.byStore;
  if (feedDateInflight) return feedDateInflight;

  feedDateInflight = (async () => {
    const res = await query<{ store_id: string; newest_source_ts: Date }>(
      `SELECT store_id, max(source_ts) AS newest_source_ts
         FROM store_price
        GROUP BY store_id`,
    );
    const byStore = new Map(res.rows.map((r) => [r.store_id, new Date(r.newest_source_ts)]));
    feedDateCache = { byStore, expiresAt: now.getTime() + FEED_DATE_TTL_MS };
    return byStore;
  })().catch((err: unknown) => {
    console.error(
      JSON.stringify({
        severity: "WARNING",
        event: "store_feed_dates_unavailable",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return new Map<string, Date>();
  });

  try {
    return await feedDateInflight;
  } finally {
    feedDateInflight = null;
  }
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
