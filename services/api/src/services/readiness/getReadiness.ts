import { query } from "@super-mcp/db";
import { ISRAEL_STORE_COORDINATE_BOUNDS } from "@super-mcp/shared";

const CURRENT_PRICE_FRESHNESS_HOURS = 48;

interface ReadinessRow {
  total_stores: string;
  stores_with_valid_coordinates: string;
  current_price_rows: string;
  stores_with_current_prices: string;
  newest_price_source_ts: string | null;
}

export interface ReadinessReport {
  status: "ready" | "degraded";
  checkedAt: string;
  storeCoordinates: {
    total: number;
    valid: number;
    coverage: number;
  };
  localPrices: {
    currentRows: number;
    storesWithCurrentPrices: number;
    newestSourceTs: string | null;
    freshnessHours: number;
  };
}

export async function getReadiness(): Promise<ReadinessReport> {
  const bounds = ISRAEL_STORE_COORDINATE_BOUNDS;
  const result = await query<ReadinessRow>(
    `SELECT
       stores.total_stores,
       stores.stores_with_valid_coordinates,
       prices.current_price_rows,
       prices.stores_with_current_prices,
       prices.newest_price_source_ts
     FROM (
       SELECT
         COUNT(*)::text AS total_stores,
         COUNT(*) FILTER (
           WHERE lat BETWEEN $1 AND $2
             AND lng BETWEEN $3 AND $4
             AND lat <> 0 AND lng <> 0
         )::text AS stores_with_valid_coordinates
       FROM store
     ) stores
     CROSS JOIN (
       SELECT
         COUNT(*) FILTER (WHERE source_ts >= now() - ($5 * interval '1 hour'))::text
           AS current_price_rows,
         COUNT(DISTINCT store_id) FILTER (WHERE source_ts >= now() - ($5 * interval '1 hour'))::text
           AS stores_with_current_prices,
         MAX(source_ts)::text AS newest_price_source_ts
       FROM store_price
     ) prices`,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, CURRENT_PRICE_FRESHNESS_HOURS],
  );
  const row = result.rows[0];
  const total = Number(row?.total_stores ?? 0);
  const valid = Number(row?.stores_with_valid_coordinates ?? 0);
  const currentRows = Number(row?.current_price_rows ?? 0);

  return {
    status: total > 0 && currentRows > 0 ? "ready" : "degraded",
    checkedAt: new Date().toISOString(),
    storeCoordinates: {
      total,
      valid,
      coverage: total > 0 ? valid / total : 0,
    },
    localPrices: {
      currentRows,
      storesWithCurrentPrices: Number(row?.stores_with_current_prices ?? 0),
      newestSourceTs: row?.newest_price_source_ts ?? null,
      freshnessHours: CURRENT_PRICE_FRESHNESS_HOURS,
    },
  };
}
