import { hasValidStoreCoordinates, type GeoPoint } from "@super-mcp/shared";
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
  "Distance ranking suppressed: store coordinates are city-level centroids, not branch addresses.";

export interface StoreLocationMetadata {
  scope: StoreLocationScope;
  precision: StoreLocationPrecision;
  fallbackApplied: boolean;
  warning: string | null;
  /**
   * False when a near-scope query only has city_centroid (or identically shared)
   * coordinates — distance ranking must not treat those as branch addresses.
   * True when near was not requested, or at least one store has address/feed geo.
   */
  distanceReliable: boolean;
  requested: {
    city: string | null;
    near: GeoPoint | null;
    radiusKm: number | null;
  };
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

function isCentroidOrUnknown(geoSource: string | null): boolean {
  return geoSource === "city_centroid" || geoSource == null;
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

  const hasReliable = stores.some((s) => isReliableGeoSource(s.geoSource));
  if (hasReliable) {
    return { ...location, distanceReliable: true };
  }

  const withCoords = stores.filter(hasValidStoreCoordinates);
  const allCityCentroid =
    withCoords.length > 0 && withCoords.every((s) => s.geoSource === "city_centroid");
  const allSharedCentroid =
    withCoords.length > 1 &&
    withCoords.every((s) => isCentroidOrUnknown(s.geoSource) && coordsMatch(s, withCoords[0]!));

  if (allCityCentroid || allSharedCentroid) {
    return {
      ...location,
      distanceReliable: false,
      // City-level points aren't branch-radius precision.
      precision: "city",
      warning: location.warning ?? CENTROID_WARNING,
    };
  }

  return { ...location, distanceReliable: false };
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
    return { stores, location: applyNearDistanceHonesty(stores, location) };
  }

  if (params.city && params.near) {
    const cityParams: ListStoresParams = {
      chain: params.chain,
      city: params.city,
      storeIds: params.storeIds,
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
          distanceReliable: true,
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
