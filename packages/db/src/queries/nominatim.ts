import { normalizeStoreCoordinates, type StoreCoordinates } from "@super-mcp/shared";

/**
 * Rate-limited Nominatim client for Israel-scoped geocoding.
 * Policy: identifying User-Agent, ≤1 req/s (enforced as ≥1.1s spacing), timeout,
 * process-wide serialization, and in-flight dedupe by cache key.
 */

export type GeocodePrecision = "address" | "street" | "neighborhood" | "city";

export interface NominatimSearchHit {
  point: StoreCoordinates;
  precision: GeocodePrecision;
  displayName: string | null;
}

export type NominatimSearchOutcome =
  | { kind: "hit"; hit: NominatimSearchHit }
  | { kind: "empty" }
  | { kind: "unavailable"; reason: string };

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export function osmAttribution(): string {
  return OSM_ATTRIBUTION;
}

function baseUrl(): string {
  return (
    process.env.NOMINATIM_BASE_URL?.trim() || "https://nominatim.openstreetmap.org"
  ).replace(/\/+$/, "");
}

function userAgent(): string {
  return (
    process.env.NOMINATIM_USER_AGENT?.trim() ||
    "super-mcp-geocode/1.0 (contact: nitaiaharoni1@gmail.com)"
  );
}

function timeoutMs(): number {
  const n = Number(process.env.NOMINATIM_TIMEOUT_MS ?? 5000);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function minIntervalMs(): number {
  const n = Number(process.env.NOMINATIM_MIN_INTERVAL_MS ?? 1100);
  return Number.isFinite(n) && n >= 1000 ? n : 1100;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Process-wide queue so concurrent callers never exceed 1 req / minInterval. */
let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, minIntervalMs() - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even when a request fails.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** In-flight dedupe keyed by opaque cache key (never the raw address). */
const inflight = new Map<string, Promise<NominatimSearchOutcome>>();

interface NominatimJsonHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  type?: string;
  class?: string;
  place_rank?: number;
}

/** Map OSM jsonv2 type fields onto our coarse precision buckets. */
export function precisionFromNominatim(hit: {
  addresstype?: string;
  type?: string;
  class?: string;
  place_rank?: number;
}): GeocodePrecision {
  const kind = (hit.addresstype || hit.type || "").toLowerCase();
  if (
    ["house", "building", "address", "place", "hamlet"].includes(kind) ||
    hit.class === "building"
  ) {
    return "address";
  }
  if (["road", "street", "residential", "pedestrian", "path", "footway"].includes(kind)) {
    return "street";
  }
  if (
    [
      "suburb",
      "neighbourhood",
      "neighborhood",
      "quarter",
      "city_block",
      "city_district",
      "borough",
    ].includes(kind)
  ) {
    return "neighborhood";
  }
  if (
    ["city", "town", "village", "municipality", "locality", "administrative"].includes(kind)
  ) {
    return "city";
  }
  // place_rank: lower = broader. ≤16 ≈ city; 17–22 ≈ neighborhood/suburb; ≥26 ≈ address.
  const rank = hit.place_rank;
  if (rank != null && Number.isFinite(rank)) {
    if (rank >= 26) return "address";
    if (rank >= 22) return "street";
    if (rank >= 17) return "neighborhood";
    return "city";
  }
  return "neighborhood";
}

async function fetchNominatim(
  params: URLSearchParams,
): Promise<NominatimSearchOutcome> {
  const url = `${baseUrl()}/search?${params.toString()}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "fetch_failed";
    return { kind: "unavailable", reason };
  }
  if (resp.status === 429 || resp.status >= 500) {
    return { kind: "unavailable", reason: `http_${resp.status}` };
  }
  if (!resp.ok) {
    return { kind: "unavailable", reason: `http_${resp.status}` };
  }
  let body: NominatimJsonHit[];
  try {
    body = (await resp.json()) as NominatimJsonHit[];
  } catch {
    return { kind: "unavailable", reason: "invalid_json" };
  }
  if (!Array.isArray(body) || body.length === 0) return { kind: "empty" };
  for (const raw of body) {
    const point = normalizeStoreCoordinates(Number(raw.lat), Number(raw.lon));
    if (!point) continue;
    return {
      kind: "hit",
      hit: {
        point,
        precision: precisionFromNominatim(raw),
        displayName: raw.display_name?.trim() || null,
      },
    };
  }
  // Hits existed but none inside Israel bounds → treat as empty, not unavailable.
  return { kind: "empty" };
}

/**
 * Free-text search. `dedupeKey` coalesces concurrent identical lookups.
 * Callers must already hold a privacy-safe key (HMAC), never the raw address.
 */
export async function nominatimSearchFreeText(
  queryText: string,
  opts: { dedupeKey: string } ,
): Promise<NominatimSearchOutcome> {
  const existing = inflight.get(opts.dedupeKey);
  if (existing) return existing;

  const params = new URLSearchParams({
    format: "jsonv2",
    countrycodes: "il",
    limit: "5",
    addressdetails: "0",
    q: queryText,
  });

  const promise = withRateLimit(() => fetchNominatim(params)).finally(() => {
    inflight.delete(opts.dedupeKey);
  });
  inflight.set(opts.dedupeKey, promise);
  return promise;
}

/**
 * Structured street+city search used by store address upgrades.
 * Falls back to free-text "address, city" on empty (still rate-limited).
 */
export async function nominatimSearchAddress(
  address: string,
  city: string,
  opts: { dedupeKey: string },
): Promise<NominatimSearchOutcome> {
  const existing = inflight.get(opts.dedupeKey);
  if (existing) return existing;

  const promise = (async () => {
    const structured = await withRateLimit(() =>
      fetchNominatim(
        new URLSearchParams({
          format: "jsonv2",
          countrycodes: "il",
          limit: "5",
          street: address,
          city,
        }),
      ),
    );
    if (structured.kind === "hit" || structured.kind === "unavailable") return structured;
    return withRateLimit(() =>
      fetchNominatim(
        new URLSearchParams({
          format: "jsonv2",
          countrycodes: "il",
          limit: "5",
          q: `${address}, ${city}`,
        }),
      ),
    );
  })().finally(() => {
    inflight.delete(opts.dedupeKey);
  });

  inflight.set(opts.dedupeKey, promise);
  return promise;
}

/** Test-only: reset rate-limit / inflight state between unit tests. */
export function _resetNominatimStateForTests(): void {
  lastRequestAt = 0;
  queue = Promise.resolve();
  inflight.clear();
}
