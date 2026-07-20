import { createHash } from "node:crypto";
import {
  canonicalizeCity,
  centroidForCity,
  cityMatchKeys,
  normalizeStoreCoordinates,
  type StoreCoordinates,
} from "@super-mcp/shared";
import { getPool } from "../client/index.js";
import { nominatimSearchAddress } from "./nominatim.js";

/**
 * Store geocoding, shared by the `geocode-stores` CLI and the ingestion service.
 * Feeds rarely carry coordinates, so `store.lat/lng` is backfilled in tiers,
 * each recording provenance in `store.geo_source`:
 *
 *   centroid : resolve the store's city to a canonical Hebrew name and stamp the
 *              city centroid. Fast, offline, city-level precision. Runs after
 *              every ingest so a new branch is never left without coordinates.
 *   address  : geocode the store's full street address via OSM Nominatim, then
 *              (optionally) fall back to an OSM Overpass supermarket POI when the
 *              chain has exactly one branch of its brand in the city. Upgrades a
 *              coarse centroid to branch-level precision. Network + rate-limited.
 *
 * The address tier only ever *upgrades* coarser rows (geo_source NULL or
 * city_centroid); it never overwrites a 'feed' or already-'address' point.
 */

interface StoreRow {
  id: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geo_source: string | null;
  chain_name_he: string | null;
  chain_name_en: string | null;
}

export interface GeocodeCentroidResult {
  scanned: number;
  updated: number;
  unmapped: number;
  topUnmapped: string[];
}

export interface GeocodeAddressResult {
  scanned: number;
  upgraded: number;
  skipped: number;
  viaAddress: number;
  viaOverpass: number;
}

export interface GeocodeOptions {
  limit?: number | null;
  dryRun?: boolean;
  city?: string | null;
}

export interface GeocodeAddressOptions extends GeocodeOptions {
  /** Also try an OSM Overpass supermarket-POI match when Nominatim misses. */
  overpass?: boolean;
}

/** SQL fragment + params for optional city filter via cityMatchKeys. */
function cityFilterClause(
  city: string | null | undefined,
  startParam: number,
): { sql: string; params: string[][] } {
  if (!city) return { sql: "", params: [] };
  const keys = cityMatchKeys(city);
  if (keys.length === 0) throw new Error(`city=${city} produced no match keys`);
  return { sql: ` AND city = ANY($${startParam}::text[])`, params: [keys] };
}

/** Haversine distance in km between two WGS84 points. */
export function distanceKm(a: StoreCoordinates, b: StoreCoordinates): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function storeAddressDedupeKey(address: string, city: string): string {
  return createHash("sha256").update(`store|${address}|${city}`, "utf8").digest("hex");
}

/** Tier 1: stamp every ungeocoded store with its city centroid. */
export async function backfillCentroids(
  opts: GeocodeOptions = {},
): Promise<GeocodeCentroidResult> {
  const { limit = null, dryRun = false, city = null } = opts;
  const pool = getPool();
  const cityFilter = cityFilterClause(city, 1);
  const res = await pool.query<StoreRow>(
    `SELECT id, city, address, lat, lng, geo_source, NULL AS chain_name_he, NULL AS chain_name_en
       FROM store
      WHERE (lat IS NULL OR lng IS NULL)${cityFilter.sql}
      ORDER BY id
      ${limit ? `LIMIT ${limit}` : ""}`,
    cityFilter.params,
  );

  let updated = 0;
  let unmapped = 0;
  const unmappedCities = new Map<string, number>();

  for (const row of res.rows) {
    const centroid = centroidForCity(row.city);
    if (!centroid) {
      unmapped += 1;
      const key = canonicalizeCity(row.city) ?? String(row.city ?? "(null)");
      unmappedCities.set(key, (unmappedCities.get(key) ?? 0) + 1);
      continue;
    }
    if (!dryRun) {
      await pool.query(
        `UPDATE store SET lat = $1, lng = $2, geo_source = 'city_centroid', updated_at = now()
          WHERE id = $3`,
        [centroid.lat, centroid.lng, row.id],
      );
    }
    updated += 1;
  }

  const topUnmapped = [...unmappedCities.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([c, n]) => `${c}:${n}`);

  return { scanned: res.rows.length, updated, unmapped, topUnmapped };
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Chain-brand tokens to match an OSM POI name/brand against (length ≥ 2). */
function brandTokens(he: string | null, en: string | null): string[] {
  const tokens = new Set<string>();
  for (const raw of [he, en]) {
    if (!raw) continue;
    for (const t of raw.toLowerCase().split(/[\s,./|()-]+/)) {
      if (t.length >= 2) tokens.add(t);
    }
  }
  return [...tokens];
}

/**
 * Free per-branch fallback: find supermarket POIs of this store's chain within
 * ~8km of the city centroid via OSM Overpass. Accept ONLY when exactly one
 * distinct-location brand match exists in the city — multiple same-brand
 * branches are ambiguous (we can't tell which POI is this branch) and would risk
 * assigning another branch's coordinates, which is worse than a centroid.
 */
async function geocodeOverpassPoi(
  chainHe: string | null,
  chainEn: string | null,
  centroid: StoreCoordinates,
): Promise<StoreCoordinates | null> {
  const tokens = brandTokens(chainHe, chainEn);
  if (tokens.length === 0) return null;

  const q = `[out:json][timeout:25];
(
  node["shop"~"supermarket|convenience"](around:8000,${centroid.lat},${centroid.lng});
  way["shop"~"supermarket|convenience"](around:8000,${centroid.lat},${centroid.lng});
);
out center tags;`;
  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": "super-mcp-geocode/1.0 (contact: nitaiaharoni1@gmail.com)" },
    body: `data=${encodeURIComponent(q)}`,
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as { elements?: OverpassElement[] };
  const matches: StoreCoordinates[] = [];
  for (const el of body.elements ?? []) {
    const tags = el.tags ?? {};
    const hay = `${tags.name ?? ""} ${tags["name:he"] ?? ""} ${tags["name:en"] ?? ""} ${tags.brand ?? ""}`.toLowerCase();
    if (!tokens.some((t) => hay.includes(t))) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const coord = normalizeStoreCoordinates(lat, lon);
    if (coord) matches.push(coord);
  }
  const distinct = matches.filter(
    (m, i) => matches.findIndex((n) => distanceKm(m, n) < 0.15) === i,
  );
  return distinct.length === 1 ? distinct[0]! : null;
}

/**
 * Tier 2: upgrade coarse rows (geo_source NULL or city_centroid) to branch-level
 * precision. Accepts a hit only when it passes the Israel-bounds guard AND lands
 * within ~15km of the store's city centroid (guards against a namesake street or
 * the wrong town). Nominatim first; optional Overpass POI fallback.
 */
export async function upgradeStoreAddresses(
  opts: GeocodeAddressOptions = {},
): Promise<GeocodeAddressResult> {
  const { limit = null, dryRun = false, city = null, overpass = false } = opts;
  const pool = getPool();
  const cityFilter = cityFilterClause(city, 1);
  const res = await pool.query<StoreRow>(
    `SELECT s.id, s.city, s.address, s.lat, s.lng, s.geo_source,
            c.name_he AS chain_name_he, c.name_en AS chain_name_en
       FROM store s
       JOIN chain c ON c.id = s.chain_id
      WHERE s.address IS NOT NULL
        AND (s.geo_source IS NULL OR s.geo_source = 'city_centroid')${cityFilter.sql}
      ORDER BY s.id
      ${limit ? `LIMIT ${limit}` : ""}`,
    cityFilter.params,
  );

  let upgraded = 0;
  let skipped = 0;
  let viaAddress = 0;
  let viaOverpass = 0;
  const MAX_KM = 15;

  for (const row of res.rows) {
    const canonical = canonicalizeCity(row.city);
    const centroid = centroidForCity(row.city);
    if (!canonical || !centroid || !row.address) {
      skipped += 1;
      continue;
    }

    let hit: StoreCoordinates | null = null;
    let source: "address" | "overpass" = "address";
    try {
      const outcome = await nominatimSearchAddress(row.address, canonical, {
        dedupeKey: storeAddressDedupeKey(row.address, canonical),
      });
      if (outcome.kind === "hit") hit = outcome.hit.point;
    } catch {
      hit = null;
    }
    if (!hit && overpass) {
      await sleep(1100);
      try {
        hit = await geocodeOverpassPoi(row.chain_name_he, row.chain_name_en, centroid);
        if (hit) source = "overpass";
      } catch {
        hit = null;
      }
    }
    if (!hit || distanceKm(hit, centroid) > MAX_KM) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await pool.query(
        `UPDATE store SET lat = $1, lng = $2, geo_source = $3, updated_at = now()
          WHERE id = $4`,
        [hit.lat, hit.lng, source, row.id],
      );
    }
    upgraded += 1;
    if (source === "address") viaAddress += 1;
    else viaOverpass += 1;
  }

  return { scanned: res.rows.length, upgraded, skipped, viaAddress, viaOverpass };
}
