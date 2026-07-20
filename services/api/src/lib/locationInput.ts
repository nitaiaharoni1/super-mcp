import {
  resolveGeocodeQuery,
  type GeocodeResolveResult,
} from "@super-mcp/db";
import { AppError, type GeoPoint } from "@super-mcp/shared";
import { resolveRadiusKm } from "./defaults.js";
import { parseNear } from "./geo.js";
import type { StoreLocationMetadata } from "./resolveStoreLocation.js";

export type LocationOriginPrecision =
  | "address"
  | "street"
  | "neighborhood"
  | "city"
  | "coordinates";

export type LocationOriginProvider =
  | "nominatim"
  | "city_centroid"
  | "coordinates";

/** Provenance for a resolved user origin point (never includes raw location text). */
export interface LocationOriginMeta {
  precision: LocationOriginPrecision;
  provider: LocationOriginProvider;
  cached: boolean;
  fallbackApplied: boolean;
  displayName: string | null;
  attribution: string | null;
  warning: string | null;
}

export interface LocationInputFields {
  city?: string;
  /** Raw 'lat,lng' string from the boundary, or already-parsed GeoPoint. */
  near?: string | GeoPoint;
  /** Free-text neighborhood/address (3–300 chars). */
  location?: string;
  radiusKm?: number;
}

export interface ResolvedLocationInput {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  locationOrigin?: LocationOriginMeta;
}

export type GeocodeResolver = (input: {
  location: string;
  city?: string | null;
}) => Promise<GeocodeResolveResult>;

function asNearString(near: string | GeoPoint | undefined): string | undefined {
  if (near == null) return undefined;
  if (typeof near === "string") {
    const t = near.trim();
    return t || undefined;
  }
  return `${near.lat},${near.lng}`;
}

/**
 * Resolve boundary location fields into city / near / radius + provenance.
 * - `near` is parsed locally (no network).
 * - `location` is geocoded (cache → Nominatim → optional city centroid).
 * - `near` + `location` is rejected.
 * Does not require a location — callers that need one assert after this returns.
 */
export async function resolveLocationInput(
  input: LocationInputFields,
  opts: { resolveGeocode?: GeocodeResolver } = {},
): Promise<ResolvedLocationInput> {
  const city = input.city?.trim() || undefined;
  const location = input.location?.trim() || undefined;
  const nearRaw = asNearString(input.near);

  if (nearRaw && location) {
    throw new AppError(
      "bad_request",
      "provide either 'near' (lat,lng) or 'location' (free text), not both",
      400,
    );
  }

  if (nearRaw) {
    const near =
      typeof input.near === "object" && input.near != null
        ? input.near
        : parseNear(nearRaw);
    return {
      city,
      near,
      radiusKm: resolveRadiusKm(near, input.radiusKm),
      locationOrigin: {
        precision: "coordinates",
        provider: "coordinates",
        cached: false,
        fallbackApplied: false,
        displayName: null,
        attribution: null,
        warning: null,
      },
    };
  }

  if (location) {
    if (location.length < 3 || location.length > 300) {
      throw new AppError(
        "bad_request",
        "location must be between 3 and 300 characters",
        400,
      );
    }
    const resolve = opts.resolveGeocode ?? resolveGeocodeQuery;
    const result = await resolve({ location, city });
    if (result.status === "unavailable") {
      throw new AppError(
        "geocoding_unavailable",
        "geocoding temporarily unavailable; retry or use city/near",
        503,
        { warning: result.warning },
      );
    }
    if (result.status === "not_found" || !result.point || !result.precision) {
      throw new AppError(
        "location_not_found",
        "could not resolve location; try a clearer address or use city/near",
        400,
        { warning: result.warning },
      );
    }
    const provider: LocationOriginProvider =
      result.provider === "city_centroid" ? "city_centroid" : "nominatim";
    return {
      city,
      near: result.point,
      radiusKm: resolveRadiusKm(result.point, input.radiusKm),
      locationOrigin: {
        precision: result.precision,
        provider,
        cached: result.cached,
        fallbackApplied: result.fallbackApplied,
        displayName: result.displayName,
        attribution: result.attribution,
        warning: result.warning,
      },
    };
  }

  return {
    city,
    near: undefined,
    radiusKm: input.radiusKm,
    locationOrigin: undefined,
  };
}

/**
 * Merge user-origin provenance into store-scope metadata and suppress distance
 * ranking when the origin is only city-level (even if branches have exact coords).
 */
export function applyLocationOriginHonesty(
  location: StoreLocationMetadata,
  origin: LocationOriginMeta | undefined,
): StoreLocationMetadata {
  if (!origin) return location;
  const warning = [location.warning, origin.warning].filter(Boolean).join(" ") || null;
  const cityOrigin = origin.precision === "city";
  return {
    ...location,
    warning,
    fallbackApplied: location.fallbackApplied || origin.fallbackApplied,
    distanceReliable: cityOrigin ? false : location.distanceReliable,
    precision: cityOrigin ? "city" : location.precision,
    origin: {
      precision: origin.precision,
      provider: origin.provider,
      cached: origin.cached,
      fallbackApplied: origin.fallbackApplied,
      displayName: origin.displayName,
      attribution: origin.attribution,
    },
  };
}
