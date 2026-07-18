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
