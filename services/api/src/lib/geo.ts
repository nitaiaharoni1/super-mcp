/** Location parsing + SQL distance helpers shared by store/price/basket queries. */
import { AppError } from "@super-mcp/shared";

export interface GeoPoint {
  lat: number;
  lng: number;
}

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
  return { lat, lng };
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
