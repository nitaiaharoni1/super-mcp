import { query } from "./repos.js";

export interface CatalogIntegrityReport {
  ok: boolean;
  duplicateGtins: number;
  duplicateSourceKeys: number;
  duplicateListings: number;
  duplicateStores: number;
  duplicateCurrentPrices: number;
  listingsWithoutProduct: number;
}

/**
 * Verify relational catalog invariants: one product per GTIN / source_key,
 * one listing per (chain, item_code), one store per (chain, store_code),
 * one current price per (listing, store).
 */
export async function checkCatalogIntegrity(): Promise<CatalogIntegrityReport> {
  const [gtins, sourceKeys, listings, stores, prices, orphans] = await Promise.all([
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT gtin FROM product WHERE gtin IS NOT NULL GROUP BY gtin HAVING count(*) > 1
       ) d`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT source_key FROM product WHERE source_key IS NOT NULL
         GROUP BY source_key HAVING count(*) > 1
       ) d`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT chain_id, item_code FROM listing GROUP BY 1, 2 HAVING count(*) > 1
       ) d`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT chain_id, store_code FROM store GROUP BY 1, 2 HAVING count(*) > 1
       ) d`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT listing_id, store_id FROM store_price GROUP BY 1, 2 HAVING count(*) > 1
       ) d`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM listing WHERE product_id IS NULL`,
    ),
  ]);

  const report: CatalogIntegrityReport = {
    ok: true,
    duplicateGtins: Number(gtins.rows[0]?.n ?? 0),
    duplicateSourceKeys: Number(sourceKeys.rows[0]?.n ?? 0),
    duplicateListings: Number(listings.rows[0]?.n ?? 0),
    duplicateStores: Number(stores.rows[0]?.n ?? 0),
    duplicateCurrentPrices: Number(prices.rows[0]?.n ?? 0),
    listingsWithoutProduct: Number(orphans.rows[0]?.n ?? 0),
  };
  report.ok =
    report.duplicateGtins === 0 &&
    report.duplicateSourceKeys === 0 &&
    report.duplicateListings === 0 &&
    report.duplicateStores === 0 &&
    report.duplicateCurrentPrices === 0 &&
    report.listingsWithoutProduct === 0;
  return report;
}
