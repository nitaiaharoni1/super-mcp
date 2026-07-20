import { createHmac } from "node:crypto";
import type { StoreCoordinates } from "@super-mcp/shared";
import { query } from "./query.js";
import type { GeocodePrecision } from "./nominatim.js";

export type GeocodeCacheStatus = "hit" | "miss";
export type GeocodeCacheProvider = "nominatim" | "city_centroid";

export interface GeocodeCacheRow {
  queryKey: string;
  displayName: string | null;
  point: StoreCoordinates | null;
  precision: GeocodePrecision | null;
  provider: GeocodeCacheProvider;
  status: GeocodeCacheStatus;
  expiresAt: Date;
  hits: number;
}

const POSITIVE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const CITY_CENTROID_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function cacheSecret(): string {
  const secret = process.env.GEOCODING_CACHE_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "GEOCODING_CACHE_SECRET must be set (≥32 bytes) for privacy-safe geocode caching",
    );
  }
  return secret;
}

/** Collapse whitespace + NFC; never store the raw input — only HMAC it. */
export function normalizeGeocodeQuery(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Privacy-safe cache key. Optionally qualify with a city hint so
 * "נווה עמל" + הרצליה ≠ "נווה עמל" + תל אביב.
 */
export function geocodeCacheKey(location: string, cityHint?: string | null): string {
  const normalized = normalizeGeocodeQuery(location);
  const city = cityHint?.normalize("NFC").trim().replace(/\s+/g, " ") ?? "";
  const material = `${normalized}|city:${city}`;
  return createHmac("sha256", cacheSecret()).update(material, "utf8").digest("hex");
}

export function ttlMsFor(
  status: GeocodeCacheStatus,
  provider: GeocodeCacheProvider,
): number {
  if (status === "miss") return NEGATIVE_TTL_MS;
  if (provider === "city_centroid") return CITY_CENTROID_TTL_MS;
  return POSITIVE_TTL_MS;
}

interface CacheDbRow {
  query_key: string;
  display_name: string | null;
  lat: number | string | null;
  lng: number | string | null;
  precision: GeocodePrecision | null;
  provider: GeocodeCacheProvider;
  status: GeocodeCacheStatus;
  expires_at: Date;
  hits: number | string;
}

function mapRow(row: CacheDbRow): GeocodeCacheRow {
  const lat = row.lat == null ? null : Number(row.lat);
  const lng = row.lng == null ? null : Number(row.lng);
  return {
    queryKey: row.query_key,
    displayName: row.display_name,
    point:
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null,
    precision: row.precision,
    provider: row.provider,
    status: row.status,
    expiresAt: row.expires_at,
    hits: Number(row.hits),
  };
}

/** Read a non-expired cache entry and bump hits. Expired rows are deleted. */
export async function getGeocodeCache(queryKey: string): Promise<GeocodeCacheRow | null> {
  const res = await query<CacheDbRow>(
    `SELECT query_key, display_name, lat, lng, precision, provider, status, expires_at, hits
       FROM geocode_cache
      WHERE query_key = $1`,
    [queryKey],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await query(`DELETE FROM geocode_cache WHERE query_key = $1`, [queryKey]);
    return null;
  }
  await query(`UPDATE geocode_cache SET hits = hits + 1 WHERE query_key = $1`, [queryKey]);
  return mapRow({ ...row, hits: Number(row.hits) + 1 });
}

export async function putGeocodeCache(input: {
  queryKey: string;
  displayName?: string | null;
  point?: StoreCoordinates | null;
  precision?: GeocodePrecision | null;
  provider: GeocodeCacheProvider;
  status: GeocodeCacheStatus;
}): Promise<void> {
  const ttl = ttlMsFor(input.status, input.provider);
  const expiresAt = new Date(Date.now() + ttl);
  const lat = input.status === "hit" ? input.point?.lat ?? null : null;
  const lng = input.status === "hit" ? input.point?.lng ?? null : null;
  const precision = input.status === "hit" ? input.precision ?? null : null;
  if (input.status === "hit" && (lat == null || lng == null || precision == null)) {
    throw new Error("putGeocodeCache: hit requires point + precision");
  }
  await query(
    `INSERT INTO geocode_cache
       (query_key, display_name, lat, lng, precision, provider, status, expires_at, hits, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, now())
     ON CONFLICT (query_key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       precision = EXCLUDED.precision,
       provider = EXCLUDED.provider,
       status = EXCLUDED.status,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()`,
    [
      input.queryKey,
      input.displayName ?? null,
      lat,
      lng,
      precision,
      input.provider,
      input.status,
      expiresAt,
    ],
  );
}
