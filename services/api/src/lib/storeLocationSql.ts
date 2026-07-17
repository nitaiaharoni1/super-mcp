import { cityMatchKeys } from "@super-mcp/shared";
import { resolveRadiusKm } from "./defaults.js";
import { geoBoundingBoxSql, haversineKmSql, type GeoPoint } from "./geo.js";

export interface StoreLocationFilter {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
}

export interface StoreLocationSql {
  conditions: string[];
  distanceSelect: string;
}

/** Append city/near/radius SQL fragments for store rows. Mutates params in place. */
export function storeLocationSql(
  opts: StoreLocationFilter,
  params: unknown[],
  tableAlias = "st",
): StoreLocationSql {
  const conditions: string[] = [];
  let distanceSelect = "NULL::double precision AS distance_km";

  if (opts.city) {
    params.push(cityMatchKeys(opts.city));
    conditions.push(`${tableAlias}.city = ANY($${params.length}::text[])`);
  }
  if (opts.near) {
    params.push(opts.near.lat, opts.near.lng);
    const latIdx = params.length - 1;
    const lngIdx = params.length;
    const latCol = `${tableAlias}.lat`;
    const lngCol = `${tableAlias}.lng`;
    const distanceExpr = haversineKmSql(latIdx, lngIdx, latCol, lngCol);
    distanceSelect = `${distanceExpr} AS distance_km`;
    const radiusKm = resolveRadiusKm(opts.near, opts.radiusKm);
    if (radiusKm != null) {
      params.push(radiusKm);
      const radiusIdx = params.length;
      conditions.push(geoBoundingBoxSql(latIdx, lngIdx, radiusIdx, latCol, lngCol));
      conditions.push(`${distanceExpr} <= $${radiusIdx}`);
    }
  }

  return { conditions, distanceSelect };
}

/** AND-prefixed WHERE clause fragment for embedding in larger queries. */
export function storeLocationAndClause(sql: StoreLocationSql): string {
  return sql.conditions.length ? `AND ${sql.conditions.join(" AND ")}` : "";
}
