import {
  backfillCentroids,
  backfillCityFromStoreName,
  upgradeStoreAddresses,
} from "../queries/geocode.js";
import { closePool } from "../client/index.js";

/**
 * CLI wrapper around the shared geocoding tiers (see queries/geocode.ts):
 *
 *   --mode=city: recover a missing store.city from the branch name. Offline, no
 *     coordinates written. Needed because the lower tiers key on store.city, so
 *     chains that publish an empty <City> (Yohananof, Keshet Taamim, Salach
 *     Dabach) cannot be geocoded at all until this has run.
 *   --mode=centroid (default): run the city tier first, then stamp the city
 *     centroid on every ungeocoded store. Fast, offline, city-level. Also runs
 *     automatically after each ingest.
 *   --mode=address: upgrade centroid/ungeocoded rows to branch-level precision
 *     via OSM Nominatim (add --overpass for the supermarket-POI fallback).
 *   --city=<name>: optional city filter (Hebrew/English/CBS code). Note this
 *     filters on the STORED city, so it cannot select rows the city tier has not
 *     populated yet.
 *   --limit=N / --dry-run: cap rows / skip writes.
 */

type Mode = "city" | "centroid" | "address";

function parseArgs(argv: string[]): {
  mode: Mode;
  limit: number | null;
  dryRun: boolean;
  city: string | null;
  overpass: boolean;
} {
  let mode: Mode = "centroid";
  let limit: number | null = null;
  let dryRun = false;
  let city: string | null = null;
  let overpass = false;
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "city" && value !== "centroid" && value !== "address") {
        throw new Error(`unknown --mode=${value} (expected city|centroid|address)`);
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
    } else if (arg === "--overpass") {
      overpass = true;
    }
  }
  return { mode, limit, dryRun, city, overpass };
}

async function main(): Promise<void> {
  const { mode, limit, dryRun, city, overpass } = parseArgs(process.argv.slice(2));
  if (mode === "address") {
    const result = await upgradeStoreAddresses({ limit, dryRun, city, overpass });
    console.log(JSON.stringify({ event: "geocode_address", dryRun, city, overpass, ...result }));
  } else if (mode === "city") {
    const result = await backfillCityFromStoreName({ limit, dryRun, city });
    console.log(JSON.stringify({ event: "geocode_city", dryRun, city, ...result }));
  } else {
    // City first: the centroid tier keys on store.city, so recovering it here is
    // what lets a single `--mode=centroid` run fix an entirely city-less chain.
    const cityResult = await backfillCityFromStoreName({ limit, dryRun, city });
    console.log(JSON.stringify({ event: "geocode_city", dryRun, city, ...cityResult }));
    const result = await backfillCentroids({ limit, dryRun, city });
    console.log(JSON.stringify({ event: "geocode_centroid", dryRun, city, ...result }));
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await closePool();
  process.exit(1);
});
