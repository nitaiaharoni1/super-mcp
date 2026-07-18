/** Location parsing + SQL distance helpers shared by store/price/basket queries. */
import {
  AppError,
  ISRAEL_STORE_COORDINATE_BOUNDS,
  normalizeStoreCoordinates,
  type GeoPoint,
} from "@super-mcp/shared";

export type { GeoPoint };

/** Parses a "lat,lng" query param string into a GeoPoint, or undefined if absent. */
export function parseNear(raw: string | undefined): GeoPoint | undefined {
  if (raw == null || raw.trim() === "") return undefined;

  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 2) {
    throw new AppError("bad_request", "near must be formatted as 'lat,lng'", 400, { near: raw });
  }

  const [latRaw, lngRaw] = parts;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("bad_request", "near must contain two numbers: 'lat,lng'", 400, { near: raw });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError("bad_request", "near is out of valid lat/lng range", 400, { near: raw });
  }
  const point = normalizeStoreCoordinates(lat, lng);
  if (!point) {
    throw new AppError("bad_request", "near must be within the supported Israel region", 400, {
      near: raw,
    });
  }
  return point;
}

/**
 * Haversine great-circle distance in km as a SQL expression, referencing two bound
 * numeric params (by 1-based index) for the origin point and two column names for
 * the row's lat/lng. LEAST/GREATEST guard against acos domain errors from float drift.
 */
export function haversineKmSql(
  latParamIdx: number,
  lngParamIdx: number,
  latCol: string,
  lngCol: string,
): string {
  return `(6371 * acos(LEAST(1, GREATEST(-1,
    cos(radians($${latParamIdx})) * cos(radians(${latCol})) * cos(radians(${lngCol}) - radians($${lngParamIdx}))
    + sin(radians($${latParamIdx})) * sin(radians(${latCol}))
  ))))`;
}

/**
 * Cheap rectangular prefilter before haversine (~111km per degree lat;
 * lng degrees shrink by cos(lat)). radiusKm expands ~20% for corner coverage.
 */
export function geoBoundingBoxSql(
  latParamIdx: number,
  lngParamIdx: number,
  radiusKmParamIdx: number,
  latCol: string,
  lngCol: string,
): string {
  const bounds = ISRAEL_STORE_COORDINATE_BOUNDS;
  return `(
    ${latCol} IS NOT NULL AND ${lngCol} IS NOT NULL
    AND ${latCol} <> 0 AND ${lngCol} <> 0
    AND ${latCol} BETWEEN ${bounds.minLat} AND ${bounds.maxLat}
    AND ${lngCol} BETWEEN ${bounds.minLng} AND ${bounds.maxLng}
    AND ${latCol} BETWEEN $${latParamIdx} - ($${radiusKmParamIdx} * 1.2) / 111.0
                      AND $${latParamIdx} + ($${radiusKmParamIdx} * 1.2) / 111.0
    AND ${lngCol} BETWEEN $${lngParamIdx} - ($${radiusKmParamIdx} * 1.2) / (111.0 * GREATEST(0.2, cos(radians($${latParamIdx}))))
                      AND $${lngParamIdx} + ($${radiusKmParamIdx} * 1.2) / (111.0 * GREATEST(0.2, cos(radians($${latParamIdx}))))
  )`;
}
