import type { GeoPoint } from "../../lib/geo.js";

/** Location fields accepted by product search (lexical + vector). */
export interface SearchLocationScope {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  storeIds?: string[];
  /** Catalogue scope, not location: see ResolveLocationScope. */
  branchStockedOnly?: boolean;
}

/**
 * When exact store IDs are already resolved, use them as the sole location
 * predicate. Re-checking city/near text for the same stores makes price EXISTS
 * stricter and more expensive without changing the intended scope.
 */
export function toSearchLocationParams(scope: SearchLocationScope): SearchLocationScope {
  // branchStockedOnly rides along on both paths: it is a catalogue predicate, not
  // a location one, so the storeIds short-circuit must not drop it.
  if (scope.storeIds && scope.storeIds.length > 0) {
    return { storeIds: scope.storeIds, branchStockedOnly: scope.branchStockedOnly };
  }
  const out: SearchLocationScope = { branchStockedOnly: scope.branchStockedOnly };
  if (scope.city) out.city = scope.city;
  if (scope.near) out.near = scope.near;
  if (scope.radiusKm != null) out.radiusKm = scope.radiusKm;
  return out;
}
