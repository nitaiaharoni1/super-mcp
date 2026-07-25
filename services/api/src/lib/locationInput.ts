import {
  resolveGeocodeQuery,
  type GeocodeResolveResult,
  type GeocodeStrategy,
} from "@super-mcp/db";
import { AppError, extractCityFromLocation, type GeoPoint } from "@super-mcp/shared";
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

/** How the origin point was obtained (telemetry / analytics; never raw text). */
export type GeocodeTelemetryStrategy =
  | "cache"
  | "city_fallback"
  | "nominatim"
  | "coordinates"
  | "none";

export interface ResolvedLocationInput {
  /**
   * City to use as a HARD store filter. Only ever set when the caller explicitly
   * passed one — a city merely inferred from free text is a geocoding hint, not a
   * filter (see `derivedCity`).
   */
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  /**
   * City inferred from the free-text `location` (e.g. "הרצליה" out of
   * "רחוב הבנים, הרצליה"). Used to qualify geocoding and as a last-resort scope
   * when no point could be resolved. Deliberately NOT applied as a store filter:
   * doing so restricted every address-based basket to same-city stores and hid
   * branches 3km away across a municipal border, which in Gush Dan is most of
   * the cheap competition.
   */
  derivedCity?: string;
  locationOrigin?: LocationOriginMeta;
  /** Wall time spent in this resolve call (geocode / parse); 0 when city-only. */
  geocodeMs: number;
}

/** Map provenance to a telemetry strategy label (never includes raw location text). */
export function deriveGeocodeTelemetryStrategy(
  origin:
    | {
        provider: LocationOriginProvider;
        cached: boolean;
        fallbackApplied: boolean;
      }
    | undefined,
): GeocodeTelemetryStrategy {
  if (!origin) return "none";
  if (origin.provider === "coordinates") return "coordinates";
  if (origin.cached) return "cache";
  if (origin.provider === "city_centroid" || origin.fallbackApplied) return "city_fallback";
  if (origin.provider === "nominatim") return "nominatim";
  return "none";
}

export type GeocodeResolver = (input: {
  location: string;
  city?: string | null;
  strategy?: GeocodeStrategy;
}) => Promise<GeocodeResolveResult>;

function asNearString(near: string | GeoPoint | undefined): string | undefined {
  if (near == null) return undefined;
  if (typeof near === "string") {
    const t = near.trim();
    return t || undefined;
  }
  return `${near.lat},${near.lng}`;
}

function resolveGeocodeStrategy(
  strategy: GeocodeStrategy | undefined,
): GeocodeStrategy {
  const value = strategy ?? "precise";
  switch (value) {
    case "fast":
      return "fast";
    case "precise":
      return "precise";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
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
  opts: {
    resolveGeocode?: GeocodeResolver;
    /** Defaults to precise so non-basket tools keep Nominatim behavior. */
    geocodeStrategy?: GeocodeStrategy;
  } = {},
): Promise<ResolvedLocationInput> {
  const startedAt = Date.now();
  const explicitCity = input.city?.trim() || undefined;
  const location = input.location?.trim() || undefined;
  const nearRaw = asNearString(input.near);
  const geocodeStrategy = resolveGeocodeStrategy(opts.geocodeStrategy);
  const elapsed = (): number => Date.now() - startedAt;

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
      city: explicitCity,
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
      geocodeMs: elapsed(),
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
    const derivedCity =
      explicitCity ?? extractCityFromLocation(location) ?? undefined;
    const resolve = opts.resolveGeocode ?? resolveGeocodeQuery;
    const result = await resolve({
      location,
      city: derivedCity,
      strategy: geocodeStrategy,
    });
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
      // Explicit city stays a filter; an inferred one does not (see derivedCity).
      city: explicitCity,
      derivedCity,
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
      geocodeMs: elapsed(),
    };
  }

  return {
    city: explicitCity,
    near: undefined,
    radiusKm: input.radiusKm,
    locationOrigin: undefined,
    geocodeMs: elapsed(),
  };
}

/**
 * Merge user-origin provenance into store-scope metadata.
 *
 * A city-level origin makes distances COARSE, not meaningless: measuring from the
 * city centroid instead of the doorstep shifts every store by a few km but keeps
 * their order, so the nearest branch to the centroid is still a good answer.
 * This used to set `distanceReliable = false`, which made eligibility fall back
 * to city-name matching and cut a 131-store radius comparison down to 16
 * same-city stores — the single biggest source of missed savings. Now it only
 * marks the figures approximate and records the reduced precision.
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
    distanceApproximate: location.distanceApproximate || cityOrigin,
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
