/** CHP-style default: compare / optimize within 10 km of the user. */
export const DEFAULT_RADIUS_KM = 10;

/**
 * When a `near` point is set and the caller omitted radius, use the product default.
 * City-only or global queries leave radius undefined (no geo filter).
 */
export function resolveRadiusKm(near: unknown, radiusKm: number | undefined): number | undefined {
  if (near == null) return radiusKm;
  return radiusKm ?? DEFAULT_RADIUS_KM;
}
