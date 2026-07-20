import {
  canonicalizeCity,
  centroidForCity,
  type StoreCoordinates,
} from "@super-mcp/shared";
import {
  geocodeCacheKey,
  getGeocodeCache,
  normalizeGeocodeQuery,
  putGeocodeCache,
} from "./geocodeCache.js";
import {
  nominatimSearchFreeText,
  osmAttribution,
  type GeocodePrecision,
} from "./nominatim.js";

export type GeocodeResolveStatus = "ok" | "not_found" | "unavailable";

export interface ResolveGeocodeQueryInput {
  location: string;
  /** Optional city hint to disambiguate and to qualify Nominatim / centroid fallback. */
  city?: string | null;
}

export interface GeocodeResolveResult {
  status: GeocodeResolveStatus;
  point: StoreCoordinates | null;
  precision: GeocodePrecision | null;
  /** Origin provider for the returned point (cache hits report the original provider). */
  provider: "nominatim" | "city_centroid" | null;
  cached: boolean;
  fallbackApplied: boolean;
  displayName: string | null;
  attribution: string | null;
  warning: string | null;
}

function cityCentroidFallback(
  city: string | null | undefined,
): {
  point: StoreCoordinates;
  displayName: string;
} | null {
  if (!city?.trim()) return null;
  const centroid = centroidForCity(city);
  if (!centroid) return null;
  const canonical = canonicalizeCity(city) ?? city.trim();
  return { point: centroid, displayName: canonical };
}

function buildQueryText(location: string, city?: string | null): string {
  const loc = normalizeGeocodeQuery(location);
  const cityCanon = city?.trim() ? canonicalizeCity(city) ?? city.trim() : null;
  if (!cityCanon) return loc;
  // Avoid duplicating the city when the user already included it.
  if (loc.includes(cityCanon) || loc.toLowerCase().includes(cityCanon.toLowerCase())) {
    return loc;
  }
  return `${loc}, ${cityCanon}`;
}

/**
 * Resolve a free-text user location to Israel coordinates.
 * Pipeline: cache → Nominatim → optional city-centroid fallback.
 * Never persists or logs the raw address; cache keys are HMAC digests.
 */
export async function resolveGeocodeQuery(
  input: ResolveGeocodeQueryInput,
): Promise<GeocodeResolveResult> {
  const location = normalizeGeocodeQuery(input.location);
  if (location.length < 3) {
    return {
      status: "not_found",
      point: null,
      precision: null,
      provider: null,
      cached: false,
      fallbackApplied: false,
      displayName: null,
      attribution: null,
      warning: "location query too short",
    };
  }

  const cityHint = input.city?.trim() || null;
  const cityCanon = cityHint ? canonicalizeCity(cityHint) ?? cityHint : null;
  const queryKey = geocodeCacheKey(location, cityCanon);
  const cached = await getGeocodeCache(queryKey);
  if (cached) {
    if (cached.status === "hit" && cached.point && cached.precision) {
      return {
        status: "ok",
        point: cached.point,
        precision: cached.precision,
        provider: cached.provider,
        cached: true,
        fallbackApplied: cached.provider === "city_centroid",
        displayName: cached.displayName,
        attribution: cached.provider === "nominatim" ? osmAttribution() : null,
        warning:
          cached.provider === "city_centroid"
            ? "Resolved via city centroid (cached); distance ranking may be imprecise."
            : null,
      };
    }
    // Negative cache hit — still allow city centroid fallback when city known.
    const fallback = cityCentroidFallback(cityHint);
    if (fallback) {
      return {
        status: "ok",
        point: fallback.point,
        precision: "city",
        provider: "city_centroid",
        cached: true,
        fallbackApplied: true,
        displayName: fallback.displayName,
        attribution: null,
        warning:
          "Geocoder found no match; using city centroid. Distance ranking may be imprecise.",
      };
    }
    return {
      status: "not_found",
      point: null,
      precision: null,
      provider: null,
      cached: true,
      fallbackApplied: false,
      displayName: null,
      attribution: null,
      warning: "location not found",
    };
  }

  const queryText = buildQueryText(location, cityHint);
  const outcome = await nominatimSearchFreeText(queryText, { dedupeKey: queryKey });

  if (outcome.kind === "hit") {
    await putGeocodeCache({
      queryKey,
      displayName: outcome.hit.displayName,
      point: outcome.hit.point,
      precision: outcome.hit.precision,
      provider: "nominatim",
      status: "hit",
    });
    return {
      status: "ok",
      point: outcome.hit.point,
      precision: outcome.hit.precision,
      provider: "nominatim",
      cached: false,
      fallbackApplied: false,
      displayName: outcome.hit.displayName,
      attribution: osmAttribution(),
      warning: null,
    };
  }

  if (outcome.kind === "empty") {
    const fallback = cityCentroidFallback(cityHint);
    if (fallback) {
      // Cache the centroid so subsequent hits are fast and marked city precision.
      await putGeocodeCache({
        queryKey,
        displayName: fallback.displayName,
        point: fallback.point,
        precision: "city",
        provider: "city_centroid",
        status: "hit",
      });
      return {
        status: "ok",
        point: fallback.point,
        precision: "city",
        provider: "city_centroid",
        cached: false,
        fallbackApplied: true,
        displayName: fallback.displayName,
        attribution: null,
        warning:
          "Geocoder found no match; using city centroid. Distance ranking may be imprecise.",
      };
    }
    // Confirmed empty with no city fallback — negative-cache. Never cache failures.
    await putGeocodeCache({
      queryKey,
      provider: "nominatim",
      status: "miss",
    });
    return {
      status: "not_found",
      point: null,
      precision: null,
      provider: null,
      cached: false,
      fallbackApplied: false,
      displayName: null,
      attribution: null,
      warning: "location not found",
    };
  }

  // Unavailable (timeout / 429 / 5xx) — never negative-cache.
  const fallback = cityCentroidFallback(cityHint);
  if (fallback) {
    return {
      status: "ok",
      point: fallback.point,
      precision: "city",
      provider: "city_centroid",
      cached: false,
      fallbackApplied: true,
      displayName: fallback.displayName,
      attribution: null,
      warning: `Geocoding temporarily unavailable (${outcome.reason}); using city centroid.`,
    };
  }
  return {
    status: "unavailable",
    point: null,
    precision: null,
    provider: null,
    cached: false,
    fallbackApplied: false,
    displayName: null,
    attribution: null,
    warning: `Geocoding temporarily unavailable (${outcome.reason})`,
  };
}
