import type { GeoPoint } from "../../lib/geo.js";

/** Location fields accepted by product search (lexical + vector). */
export interface SearchLocationScope {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  storeIds?: string[];
}

/**
 * When exact store IDs are already resolved, use them as the sole location
 * predicate. Re-checking city/near text for the same stores makes price EXISTS
 * stricter and more expensive without changing the intended scope.
 */
export function toSearchLocationParams(scope: SearchLocationScope): SearchLocationScope {
  if (scope.storeIds && scope.storeIds.length > 0) {
    return { storeIds: scope.storeIds };
  }
  const out: SearchLocationScope = {};
  if (scope.city) out.city = scope.city;
  if (scope.near) out.near = scope.near;
  if (scope.radiusKm != null) out.radiusKm = scope.radiusKm;
  return out;
}
