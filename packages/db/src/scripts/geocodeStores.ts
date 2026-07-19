import {
  canonicalizeCity,
  centroidForCity,
  cityMatchKeys,
  normalizeStoreCoordinates,
  type StoreCoordinates,
} from "@super-mcp/shared";
import { closePool, getPool } from "../client/index.js";

/**
 * Store feeds don't carry coordinates, so `store.lat/lng` starts NULL and the
 * API's `near=lat,lng` geo path returns nothing. This backfills coordinates in
 * two tiers, both recording provenance in `store.geo_source`:
 *
 *   --mode=centroid (default): resolve the store's city to a canonical Hebrew
 *     name and stamp the city centroid. Fast, offline, city-level precision.
 *   --mode=address: geocode the store's full street address via OSM Nominatim
 *     and upgrade to address-level precision when the result is sane (in Israel
 *     bounds and within ~15km of the city centroid). Rate-limited (≥1s/call).
 *   --city=<name>: optional city filter (Hebrew/English/code); matches via
 *     cityMatchKeys so aliases resolve to the same stores.
 *   --limit=N / --dry-run: cap rows / skip writes.
 */

type Mode = "centroid" | "address";

interface StoreRow {
  id: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geo_source: string | null;
}

function parseArgs(argv: string[]): {
  mode: Mode;
  limit: number | null;
  dryRun: boolean;
  city: string | null;
} {
  let mode: Mode = "centroid";
  let limit: number | null = null;
  let dryRun = false;
  let city: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "centroid" && value !== "address") {
        throw new Error(`unknown --mode=${value} (expected centroid|address)`);
      }
      mode = value;
    } else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(limit) || limit <= 0) throw new Error(`invalid --limit`);
    } else if (arg.startsWith("--city=")) {
      city = arg.slice("--city=".length).trim();
      if (!city) throw new Error(`invalid --city`);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { mode, limit, dryRun, city };
}

/** SQL fragment + params for optional city filter via cityMatchKeys. */
function cityFilterClause(
  city: string | null,
  startParam: number,
): { sql: string; params: string[][] } {
  if (!city) return { sql: "", params: [] };
  const keys = cityMatchKeys(city);
  if (keys.length === 0) throw new Error(`--city=${city} produced no match keys`);
  return { sql: ` AND city = ANY($${startParam}::text[])`, params: [keys] };
}

/** Haversine distance in km between two WGS84 points. */
function distanceKm(a: StoreCoordinates, b: StoreCoordinates): number {
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

/** Tier 1: stamp every ungeocoded store with its city centroid. */
async function runCentroid(
  limit: number | null,
  dryRun: boolean,
  city: string | null,
): Promise<void> {
  const pool = getPool();
  const cityFilter = cityFilterClause(city, 1);
  const res = await pool.query<StoreRow>(
    `SELECT id, city, address, lat, lng, geo_source
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
    .map(([city, n]) => `${city}:${n}`);

  console.log(
    JSON.stringify({
      event: "geocode_centroid",
      dryRun,
      city,
      scanned: res.rows.length,
      updated,
      unmapped,
      topUnmapped,
    }),
  );
}

interface NominatimHit {
  lat: string;
  lon: string;
}

async function nominatimSearch(params: URLSearchParams): Promise<StoreCoordinates | null> {
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      // Nominatim usage policy requires an identifying User-Agent.
      "User-Agent": "super-mcp-geocode/1.0 (contact: nitaiaharoni1@gmail.com)",
    },
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as NominatimHit[];
  const hit = body[0];
  if (!hit) return null;
  return normalizeStoreCoordinates(Number(hit.lat), Number(hit.lon));
}

/**
 * Query OSM Nominatim for a store address. Tries structured street+city first,
 * then a free-text "address, city" query (mall names like קניון ארנה often need
 * the free-text path).
 */
async function geocodeAddress(
  address: string,
  city: string,
): Promise<StoreCoordinates | null> {
  const structured = await nominatimSearch(
    new URLSearchParams({
      format: "json",
      countrycodes: "il",
      limit: "1",
      street: address,
      city,
    }),
  );
  if (structured) return structured;
  await sleep(1100);
  return nominatimSearch(
    new URLSearchParams({
      format: "json",
      countrycodes: "il",
      limit: "1",
      q: `${address}, ${city}`,
    }),
  );
}

/**
 * Tier 2: upgrade centroid rows to address-level precision. Only accepts a
 * Nominatim hit that passes the Israel-bounds guard AND lands within ~15km of
 * the store's city centroid (guards against Nominatim resolving to the wrong
 * town or a namesake street elsewhere).
 */
async function runAddress(
  limit: number | null,
  dryRun: boolean,
  city: string | null,
): Promise<void> {
  const pool = getPool();
  const cityFilter = cityFilterClause(city, 1);
  const res = await pool.query<StoreRow>(
    `SELECT id, city, address, lat, lng, geo_source
       FROM store
      WHERE address IS NOT NULL
        AND (geo_source IS NULL OR geo_source = 'city_centroid')${cityFilter.sql}
      ORDER BY id
      ${limit ? `LIMIT ${limit}` : ""}`,
    cityFilter.params,
  );

  let upgraded = 0;
  let skipped = 0;
  const MAX_KM = 15;

  for (const row of res.rows) {
    const canonical = canonicalizeCity(row.city);
    const centroid = centroidForCity(row.city);
    if (!canonical || !centroid || !row.address) {
      skipped += 1;
      continue;
    }

    await sleep(1100); // respect Nominatim's ≥1 req/s policy.
    let hit: StoreCoordinates | null = null;
    try {
      hit = await geocodeAddress(row.address, canonical);
    } catch {
      hit = null;
    }
    if (!hit) {
      skipped += 1;
      continue;
    }
    if (distanceKm(hit, centroid) > MAX_KM) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await pool.query(
        `UPDATE store SET lat = $1, lng = $2, geo_source = 'address', updated_at = now()
          WHERE id = $3`,
        [hit.lat, hit.lng, row.id],
      );
    }
    upgraded += 1;
  }

  console.log(
    JSON.stringify({
      event: "geocode_address",
      dryRun,
      city,
      scanned: res.rows.length,
      upgraded,
      skipped,
    }),
  );
}

async function main(): Promise<void> {
  const { mode, limit, dryRun, city } = parseArgs(process.argv.slice(2));
  if (mode === "address") {
    await runAddress(limit, dryRun, city);
  } else {
    await runCentroid(limit, dryRun, city);
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await closePool();
  process.exit(1);
});
