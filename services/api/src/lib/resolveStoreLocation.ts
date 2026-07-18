import { hasValidStoreCoordinates, type GeoPoint } from "@super-mcp/shared";
import {
  listStores,
  type ListStoresParams,
  type StoreSummary,
} from "../services/stores/index.js";
import { resolveRadiusKm } from "./defaults.js";

export type StoreLocationScope = "unscoped" | "city" | "near" | "city_near";
export type StoreLocationPrecision = "none" | "city" | "radius";

export interface StoreLocationMetadata {
  scope: StoreLocationScope;
  precision: StoreLocationPrecision;
  fallbackApplied: boolean;
  warning: string | null;
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
    requested: {
      city: params.city ?? null,
      near: params.near ?? null,
      radiusKm: params.radiusKm ?? null,
    },
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
  if (stores.length > 0) return { stores, location };

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
