import { centroidForCity } from "@super-mcp/shared";
import { distanceKm } from "./geocode.js";
import { query } from "./query.js";

export interface CatalogIntegrityReport {
  ok: boolean;
  duplicateGtins: number;
  duplicateSourceKeys: number;
  duplicateListings: number;
  duplicateStores: number;
  duplicateCurrentPrices: number;
  listingsWithoutProduct: number;
  geo: StoreGeoReport;
}

/**
 * Store-coordinate health. Advisory: it does NOT gate `ok` (geocoding coverage
 * grows asynchronously and shouldn't fail catalog CI), but surfaces silent geo
 * degradation — coordinates dropping to city-level, stores that can't be located
 * at all, and points that drifted far from their city (a bad geocode).
 */
export interface StoreGeoReport {
  totalStores: number;
  /** geo_source in (feed, address, overpass): trusted for distance ranking. */
  branchLevelStores: number;
  /** geo_source = city_centroid: coarse, ignored by distance ranking. */
  cityCentroidStores: number;
  /** lat/lng NULL: store cannot be placed on the map at all. */
  ungeocodedStores: number;
  /** Store has no usable city, so even a centroid can't be stamped. */
  cityUnknownStores: number;
  /** Branch-level point that sits >15km from its own city centroid (likely bad). */
  coordsFarFromCentroid: number;
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
    geo: await checkStoreGeo(),
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

const FAR_FROM_CENTROID_KM = 15;

/** Aggregate store-coordinate health (advisory; see StoreGeoReport). */
export async function checkStoreGeo(): Promise<StoreGeoReport> {
  const [counts, branchLevel] = await Promise.all([
    query<{
      total: string;
      branch_level: string;
      city_centroid: string;
      ungeocoded: string;
      city_unknown: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE geo_source IN ('feed','address','overpass'))::text AS branch_level,
              count(*) FILTER (WHERE geo_source = 'city_centroid')::text AS city_centroid,
              count(*) FILTER (WHERE lat IS NULL OR lng IS NULL)::text AS ungeocoded,
              count(*) FILTER (WHERE city IS NULL OR btrim(city) = '')::text AS city_unknown
         FROM store`,
    ),
    // Branch-level points only: verify each still sits near its own city.
    query<{ city: string | null; lat: number; lng: number }>(
      `SELECT city, lat, lng FROM store
        WHERE lat IS NOT NULL AND lng IS NOT NULL
          AND geo_source IN ('feed','address','overpass')`,
    ),
  ]);

  let coordsFarFromCentroid = 0;
  for (const row of branchLevel.rows) {
    const centroid = centroidForCity(row.city);
    if (!centroid) continue; // no centroid to compare against
    if (distanceKm({ lat: row.lat, lng: row.lng }, centroid) > FAR_FROM_CENTROID_KM) {
      coordsFarFromCentroid += 1;
    }
  }

  const c = counts.rows[0];
  return {
    totalStores: Number(c?.total ?? 0),
    branchLevelStores: Number(c?.branch_level ?? 0),
    cityCentroidStores: Number(c?.city_centroid ?? 0),
    ungeocodedStores: Number(c?.ungeocoded ?? 0),
    cityUnknownStores: Number(c?.city_unknown ?? 0),
    coordsFarFromCentroid,
  };
}
