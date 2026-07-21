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

const APPROXIMATE_MATCH_WARNING =
  "Approximate match: the geocoder resolved this to a different area than the neighborhood requested; distance ranking may be imprecise.";

/**
 * Hebrew place words that don't disambiguate a neighborhood on their own
 * ("נווה עמל" and "נווה עובד" share "נווה"). Dropping them isolates the
 * distinctive token so a wrong-neighborhood match is detectable.
 */
const GENERIC_PLACE_WORDS = new Set([
  "נווה", "קרית", "קריית", "רמת", "גבעת", "כפר", "שכונת", "שכונה",
  "מרכז", "העיר", "צפון", "דרום", "מזרח", "מערב", "רחוב", "שדרות",
  "שד", "דרך", "סניף", "פינת",
]);

const hasHebrew = (s: string): boolean => /[֐-׿]/.test(s);

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/["'’.,\/()־-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The neighborhood portion of a free-text location, excluding the city. */
function neighborhoodQueryPart(location: string, cityCanon: string | null): string {
  const normalized = location.normalize("NFC").trim();
  const firstSegment = normalized.split(",")[0]?.trim() || normalized;
  if (cityCanon && normalizeForMatch(firstSegment) === normalizeForMatch(cityCanon)) {
    return normalized.split(cityCanon).join(" ").trim() || normalized;
  }
  return firstSegment;
}

/** Distinctive Hebrew tokens of a place name (drops city, generic, and numeric tokens). */
function distinctivePlaceTokens(text: string, cityCanon: string | null): string[] {
  const cityTokens = new Set(
    cityCanon ? normalizeForMatch(cityCanon).split(" ").filter(Boolean) : [],
  );
  return normalizeForMatch(text)
    .split(" ")
    .filter(
      (t) =>
        t.length >= 2 &&
        hasHebrew(t) &&
        !/^\d+$/.test(t) &&
        !GENERIC_PLACE_WORDS.has(t) &&
        !cityTokens.has(t),
    );
}

/**
 * True when Nominatim resolved a neighborhood query to a clearly different area:
 * NONE of the query's distinctive place tokens appear in the returned display
 * name (e.g. "נווה עמל" → a post office in "נווה עובד"). Gated on Hebrew script
 * on both sides so transliterated display names never trigger a false positive.
 */
function isNeighborhoodMismatch(
  location: string,
  cityCanon: string | null,
  displayName: string | null,
): boolean {
  if (!displayName || !hasHebrew(displayName)) return false;
  const tokens = distinctivePlaceTokens(
    neighborhoodQueryPart(location, cityCanon),
    cityCanon,
  );
  if (tokens.length === 0) return false;
  const haystack = normalizeForMatch(displayName);
  return tokens.every((t) => !haystack.includes(t));
}

/**
 * Downgrade a confident Nominatim hit to city precision when it resolved to the
 * wrong neighborhood. City precision is honest here (we trust the city, not the
 * sub-city point) and flips distanceReliable=false via applyLocationOriginHonesty.
 * Applied to fresh and cached hits alike, so it retroactively repairs bad entries.
 */
function downgradeOnMismatch(
  location: string,
  cityCanon: string | null,
  displayName: string | null,
  precision: GeocodePrecision,
): { precision: GeocodePrecision; warning: string | null } {
  if (precision === "city") return { precision, warning: null };
  if (isNeighborhoodMismatch(location, cityCanon, displayName)) {
    return { precision: "city", warning: APPROXIMATE_MATCH_WARNING };
  }
  return { precision, warning: null };
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
      const isNominatim = cached.provider === "nominatim";
      const adjusted = isNominatim
        ? downgradeOnMismatch(location, cityCanon, cached.displayName, cached.precision)
        : { precision: cached.precision, warning: null as string | null };
      return {
        status: "ok",
        point: cached.point,
        precision: adjusted.precision,
        provider: cached.provider,
        cached: true,
        fallbackApplied: cached.provider === "city_centroid",
        displayName: cached.displayName,
        attribution: isNominatim ? osmAttribution() : null,
        warning: isNominatim
          ? adjusted.warning
          : "Resolved via city centroid (cached); distance ranking may be imprecise.",
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
    // Cache the raw Nominatim precision; the mismatch downgrade is response-only
    // so a later provider/data improvement isn't masked by a persisted downgrade.
    await putGeocodeCache({
      queryKey,
      displayName: outcome.hit.displayName,
      point: outcome.hit.point,
      precision: outcome.hit.precision,
      provider: "nominatim",
      status: "hit",
    });
    const adjusted = downgradeOnMismatch(
      location,
      cityCanon,
      outcome.hit.displayName,
      outcome.hit.precision,
    );
    return {
      status: "ok",
      point: outcome.hit.point,
      precision: adjusted.precision,
      provider: "nominatim",
      cached: false,
      fallbackApplied: false,
      displayName: outcome.hit.displayName,
      attribution: osmAttribution(),
      warning: adjusted.warning,
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
