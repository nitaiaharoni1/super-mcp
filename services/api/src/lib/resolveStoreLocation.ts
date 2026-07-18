import { hasValidStoreCoordinates, type GeoPoint } from "@super-mcp/shared";
import {
  listStores,
  type ListStoresParams,
  type StoreSummary,
} from "../services/stores/index.js";

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
 * Resolve stores once under the requested scope. The only broadening allowed is
 * city+near -> city when every matching city branch lacks usable coordinates.
 */
export async function resolveStoreLocation(
  params: ListStoresParams,
  loadStores: StoreLoader = listStores,
): Promise<ResolvedStoreLocation> {
  const stores = await loadStores(params);
  const location = requestedMetadata(params);
  if (stores.length > 0 || !params.city || !params.near) return { stores, location };

  const cityParams: ListStoresParams = {
    chain: params.chain,
    city: params.city,
    storeIds: params.storeIds,
  };
  const cityStores = await loadStores(cityParams);
  if (cityStores.length === 0 || cityStores.some(hasValidStoreCoordinates)) {
    return { stores, location };
  }

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
