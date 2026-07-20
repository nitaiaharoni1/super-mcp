/**
 * Live canary for free-text location geocoding (Nominatim + cache).
 *
 * Usage:
 *   GEOCODING_CACHE_SECRET=... pnpm --filter @super-mcp/api exec tsx src/scripts/canaryGeocode.ts
 *
 * Optional:
 *   CANARY_GEOCODE_LOCATION="נווה עמל, הרצליה"
 *   CANARY_GEOCODE_CITY="הרצליה"
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool, resolveGeocodeQuery } from "@super-mcp/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function main(): Promise<void> {
  const secret = process.env.GEOCODING_CACHE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("GEOCODING_CACHE_SECRET must be set (≥32 bytes)");
  }

  const location = process.env.CANARY_GEOCODE_LOCATION?.trim() || "נווה עמל, הרצליה";
  const city = process.env.CANARY_GEOCODE_CITY?.trim() || "הרצליה";

  const first = await resolveGeocodeQuery({ location, city });
  const second = await resolveGeocodeQuery({ location, city });

  const report = {
    event: "canary_geocode",
    locationHint: city,
    // Never echo the raw location string in logs for privacy — report lengths only.
    locationChars: location.length,
    first: {
      status: first.status,
      cached: first.cached,
      precision: first.precision,
      provider: first.provider,
      fallbackApplied: first.fallbackApplied,
      attribution: first.attribution,
      point: first.point,
      warning: first.warning,
    },
    second: {
      status: second.status,
      cached: second.cached,
      precision: second.precision,
      provider: second.provider,
      point: second.point,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (first.status !== "ok" || !first.point) {
    throw new Error(`canary geocode failed: ${first.status} (${first.warning ?? "no detail"})`);
  }
  if (first.point.lat < 29 || first.point.lat > 34 || first.point.lng < 34 || first.point.lng > 36) {
    throw new Error("canary geocode point outside expected Israel bounds");
  }
  if (!second.cached) {
    throw new Error("canary geocode expected second call to be a cache hit");
  }
  if (first.provider === "nominatim" && !first.attribution?.includes("OpenStreetMap")) {
    throw new Error("canary geocode missing OSM attribution");
  }
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
