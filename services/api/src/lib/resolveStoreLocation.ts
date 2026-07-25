import {
  cityMatchKeys,
  hasValidStoreCoordinates,
  isShoppableStoreKind,
  type GeoPoint,
} from "@super-mcp/shared";
import {
  listStores,
  type ListStoresParams,
  type StoreSummary,
} from "../services/stores/index.js";
import { resolveRadiusKm } from "./defaults.js";
export type StoreLocationScope = "unscoped" | "city" | "near" | "city_near";
export type StoreLocationPrecision = "none" | "city" | "radius";

/** Degrees — ~1m at Israeli latitudes; used to detect shared city centroids. */
const COORD_EPSILON = 1e-5;

const CENTROID_WARNING =
  "Distance ranking suppressed: every matching store shares one city-level coordinate, so branches cannot be told apart by distance.";

const APPROXIMATE_DISTANCE_WARNING =
  "Distances are approximate: measured from a city-level origin or to a city-level store coordinate.";

/**
 * The radius is applied strictly, in SQL, to the recorded distance.
 *
 * An earlier version added a few km of slack here for city-placed stores, on the
 * theory that a centroid-derived distance near the boundary should get grace. It
 * was dead code: `storeLocationSql` already cuts `distance <= radiusKm` before
 * these rows are ever loaded, so nothing outside the radius reached the check.
 * Rather than widen the shared SQL filter (which also serves compare_prices), the
 * radius stays the shopper's stated constraint. Positional uncertainty is instead
 * priced into RANKING via CITY_ACCURACY_UNCERTAINTY_KM in recommendStores, which
 * is where it changes an outcome rather than silently widening the search.
 *
 * The bug that mattered — city-placed stores excluded from recommendations
 * ENTIRELY, which hid whole discount chains — is fixed by
 * `isEligibleForDistanceRecommendation` no longer requiring branch-level coords.
 */

/** Provenance of the user origin — mirrors LocationOriginMeta without importing it. */
export interface StoreLocationOriginMeta {
  precision: "address" | "street" | "neighborhood" | "city" | "coordinates";
  provider: "nominatim" | "city_centroid" | "coordinates";
  cached: boolean;
  fallbackApplied: boolean;
  displayName: string | null;
  attribution: string | null;
}

export interface StoreLocationMetadata {
  scope: StoreLocationScope;
  precision: StoreLocationPrecision;
  fallbackApplied: boolean;
  warning: string | null;
  /**
   * False only when distance cannot order the candidates at all — every matching
   * store collapses onto one shared coordinate, so "nearest" is meaningless.
   *
   * A city-level ORIGIN no longer clears this flag. Measuring from a city centroid
   * instead of the exact doorstep shifts every store by a few km but preserves
   * their order, and suppressing distance in that case is what silently reduced a
   * 131-store radius comparison to 16 same-city stores.
   */
  distanceReliable: boolean;
  /**
   * True when distances are usable but coarse — a city-level origin, or stores
   * placed by city centroid. Callers should present them as approximate.
   */
  distanceApproximate: boolean;
  requested: {
    city: string | null;
    near: GeoPoint | null;
    radiusKm: number | null;
  };
  /** Provenance of the user origin point when `location` or `near` was resolved. */
  origin?: StoreLocationOriginMeta;
}

export interface ResolvedStoreLocation {
  stores: StoreSummary[];
  location: StoreLocationMetadata;
}

export type StoreLoader = (params: ListStoresParams) => Promise<StoreSummary[]>;

function requestedMetadata(params: ListStoresParams): StoreLocationMetadata {
  const scope: StoreLocationScope =
    params.city && params.near ? "city_near" : params.city ? "city" : params.near ? "near" : "unscoped";
  return {
    scope,
    precision: params.near ? "radius" : params.city ? "city" : "none",
    fallbackApplied: false,
    warning: null,
    // Near not requested → distance is irrelevant / reliable by default.
    distanceReliable: !params.near,
    distanceApproximate: false,
    requested: {
      city: params.city ?? null,
      near: params.near ?? null,
      radiusKm: params.radiusKm ?? null,
    },
  };
}

function isReliableGeoSource(geoSource: string | null): boolean {
  return geoSource === "address" || geoSource === "feed";
}

/** Branch-level coords safe for radius recommendations (matches priceStoreBasket). */
function isBranchGeoSource(geoSource: string | null): boolean {
  return geoSource === "address" || geoSource === "feed" || geoSource === "overpass";
}

function isCentroidOrUnknown(geoSource: string | null): boolean {
  return geoSource === "city_centroid" || geoSource == null;
}

function storeMatchesRequestedCity(store: StoreSummary, city: string): boolean {
  if (store.city == null) return false;
  const keys = new Set(cityMatchKeys(city));
  if (keys.has(store.city)) return true;
  return cityMatchKeys(store.city).some((key) => keys.has(key));
}

/**
 * True when a store may appear in distance-scoped recommendations
 * (bestSingleStore / cheapestCompleteStore / multiStore).
 *
 * Rules, in order:
 *  - never recommend a non-branch endpoint (online / pickup / warehouse): those
 *    rows carry the deepest price catalogs in the feed but are not places to shop
 *  - no point requested: city membership when a city was given, else everything
 *  - degenerate distance (all stores share one coordinate): fall back to city
 *    membership if a city was given, otherwise keep them — a comparison ranked on
 *    price alone is still useful, and returning nothing is not
 *  - otherwise: inside the radius, allowing city-placed stores a small slack
 */
export function isEligibleForDistanceRecommendation(
  store: StoreSummary,
  location: StoreLocationMetadata,
): boolean {
  if (!isShoppableStoreKind(store.storeKind)) return false;

  const near = location.requested.near;
  const city = location.requested.city;

  if (!near) {
    if (city) return storeMatchesRequestedCity(store, city);
    return true;
  }

  if (!location.distanceReliable) {
    if (city) return storeMatchesRequestedCity(store, city);
    // Distance cannot order these, but they are still real priced stores in the
    // requested scope. Rank them on price rather than recommending nothing.
    return true;
  }

  const radiusKm = resolveRadiusKm(near, location.requested.radiusKm ?? undefined);
  if (store.distanceKm == null) return false;
  if (radiusKm == null) return true;
  return store.distanceKm <= radiusKm;
}

/**
 * Drop known out-of-radius branches from a reliable near result set.
 * Stores with unknown distance are kept as informational (recommendation filter
 * excludes them later).
 */
function rejectKnownOutOfRadiusStores(
  stores: StoreSummary[],
  location: StoreLocationMetadata,
): StoreSummary[] {
  const near = location.requested.near;
  if (!near || !location.distanceReliable) {
    return stores;
  }
  const radiusKm = resolveRadiusKm(near, location.requested.radiusKm ?? undefined);
  if (radiusKm == null) return stores;
  return stores.filter((store) => {
    if (store.distanceKm == null) return true;
    return store.distanceKm <= radiusKm;
  });
}

function coordsMatch(a: StoreSummary, b: StoreSummary): boolean {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
  return Math.abs(a.lat - b.lat) <= COORD_EPSILON && Math.abs(a.lng - b.lng) <= COORD_EPSILON;
}

/**
 * When near is requested and stores are returned, decide whether distance
 * ranking is honest and whether to warn about city-level centroids.
 */
function applyNearDistanceHonesty(
  stores: StoreSummary[],
  location: StoreLocationMetadata,
): StoreLocationMetadata {
  if (!location.requested.near) return location;

  const withCoords = stores.filter(hasValidStoreCoordinates);

  // Distance can only fail to order stores when they all sit on the same point.
  const allSharedCoordinate =
    withCoords.length > 1 &&
    withCoords.every((s) => isCentroidOrUnknown(s.geoSource) && coordsMatch(s, withCoords[0]!));

  if (allSharedCoordinate) {
    return {
      ...location,
      distanceReliable: false,
      distanceApproximate: true,
      // One shared city point is not branch-radius precision.
      precision: "city",
      warning: location.warning ?? CENTROID_WARNING,
    };
  }

  const anyCityPlaced = withCoords.some((s) => !isReliableGeoSource(s.geoSource));
  return {
    ...location,
    distanceReliable: withCoords.length > 0,
    distanceApproximate: location.distanceApproximate || anyCityPlaced,
    warning:
      location.warning ?? (anyCityPlaced ? APPROXIMATE_DISTANCE_WARNING : null),
  };
}

/**
 * Progressively shorten a city string by dropping trailing whitespace-separated
 * tokens (e.g. "הרצליה נווה עמל" -> "הרצליה נווה" -> "הרצליה"), re-running the
 * SAME city matcher (`loadStores` with a city-only param set) until one yields
 * stores. Bounded: stops at a single remaining token.
 */
async function resolveCityByShortening(
  params: ListStoresParams,
  loadStores: StoreLoader,
): Promise<{ city: string; stores: StoreSummary[] } | null> {
  const tokens = (params.city ?? "").trim().split(/\s+/).filter(Boolean);
  for (let end = tokens.length - 1; end >= 1; end -= 1) {
    const city = tokens.slice(0, end).join(" ");
    const shortenedStores = await loadStores({
      chain: params.chain,
      city,
      storeIds: params.storeIds,
      shoppableOnly: params.shoppableOnly,
    });
    if (shortenedStores.length > 0) return { city, stores: shortenedStores };
  }
  return null;
}

/**
 * Resolve stores once under the requested scope, then apply bounded honesty
 * fallbacks when the requested scope yields nothing:
 *  - city+near -> city when every matching city branch lacks usable coordinates
 *  - city -> a shorter city string (dropping neighborhood suffixes)
 *  - near -> a warning distinguishing "no coordinates in DB" from "none in range"
 */
export async function resolveStoreLocation(
  params: ListStoresParams,
  loadStores: StoreLoader = listStores,
): Promise<ResolvedStoreLocation> {
  const stores = await loadStores(params);
  const location = requestedMetadata(params);
  if (stores.length > 0) {
    const honest = applyNearDistanceHonesty(stores, location);
    return {
      stores: rejectKnownOutOfRadiusStores(stores, honest),
      location: honest,
    };
  }

  if (params.city && params.near) {
    const cityParams: ListStoresParams = {
      chain: params.chain,
      city: params.city,
      storeIds: params.storeIds,
      // Must survive the fallback: dropping it let online / warehouse rows back
      // into a basket comparison, inflating storesCompared with endpoints the
      // recommendation layer then has to filter out again.
      shoppableOnly: params.shoppableOnly,
    };
    const cityStores = await loadStores(cityParams);
    if (cityStores.length > 0 && !cityStores.some(hasValidStoreCoordinates)) {
      return {
        stores: cityStores,
        location: {
          ...location,
          scope: "city",
          precision: "city",
          fallbackApplied: true,
          // Fell back off near — distance ranking is no longer near-based.
          // City membership drives eligibility; do not treat as radius-reliable.
          distanceReliable: false,
          warning:
            "Nearby precision unavailable because matching city branches lack valid coordinates; results use city scope.",
        },
      };
    }
    return { stores, location };
  }

  if (params.city) {
    const shortened = await resolveCityByShortening(params, loadStores);
    if (shortened) {
      return {
        stores: shortened.stores,
        location: {
          ...location,
          fallbackApplied: true,
          warning: `no stores matched '${params.city}'; using '${shortened.city}'`,
        },
      };
    }
    return {
      stores,
      location: { ...location, warning: `no stores matched city '${params.city}'` },
    };
  }

  if (params.near) {
    const reloadParams: ListStoresParams = {
      chain: params.chain,
      storeIds: params.storeIds,
      shoppableOnly: params.shoppableOnly,
    };
    const candidates = await loadStores(reloadParams);
    const anyGeocoded = candidates.some(hasValidStoreCoordinates);
    const warning = anyGeocoded
      ? `no stores within ${resolveRadiusKm(params.near, params.radiusKm)}km`
      : "store coordinates unavailable; use city instead";
    return { stores, location: { ...location, warning } };
  }

  return { stores, location };
}
