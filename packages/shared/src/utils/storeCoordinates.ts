export interface StoreCoordinates {
  lat: number;
  lng: number;
}

export const ISRAEL_STORE_COORDINATE_BOUNDS = {
  minLat: 29,
  maxLat: 34,
  minLng: 34,
  maxLng: 36,
} as const;

/** Normalize feed coordinates to a complete, finite point in the supported Israel region. */
export function normalizeStoreCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
): StoreCoordinates | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 || lng === 0) return null;

  const bounds = ISRAEL_STORE_COORDINATE_BOUNDS;
  if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) {
    return null;
  }

  return { lat, lng };
}

export function hasValidStoreCoordinates(value: {
  lat: number | null;
  lng: number | null;
}): boolean {
  return normalizeStoreCoordinates(value.lat, value.lng) != null;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance in km, in TypeScript.
 *
 * Store ranking measures distance in SQL (`haversineKmSql`) because it filters
 * hundreds of rows inside the query. Delivery coverage is the opposite shape: a
 * handful of service areas already in memory, tested against one address. Same
 * formula, deliberately kept in step with the SQL version.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
