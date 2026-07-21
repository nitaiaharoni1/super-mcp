/**
 * Live canary for free-text location geocoding.
 *
 * Fast city-fallback (no Nominatim network) — default:
 *   GEOCODING_CACHE_SECRET=... pnpm --filter @super-mcp/api canary:geocode
 *
 * Precise Nominatim + cache path:
 *   CANARY_GEOCODE_MODE=precise GEOCODING_CACHE_SECRET=... \
 *     pnpm --filter @super-mcp/api canary:geocode
 *
 * Optional:
 *   CANARY_GEOCODE_LOCATION="רחוב בן גוריון, תל אביב"
 *   CANARY_GEOCODE_CITY="תל אביב"
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool, resolveGeocodeQuery } from "@super-mcp/db";
import { TEL_AVIV_LOCATION } from "./canary/telAvivStaplesFixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function runFastCityFallback(): Promise<void> {
  const location = process.env.CANARY_GEOCODE_LOCATION?.trim() || TEL_AVIV_LOCATION;
  const city = process.env.CANARY_GEOCODE_CITY?.trim() || undefined;

  const fetchCallsBefore = (globalThis as { __canaryFetchCount?: number }).__canaryFetchCount ?? 0;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    networkCalls += 1;
    return originalFetch(...args);
  }) as typeof fetch;

  try {
    const result = await resolveGeocodeQuery({
      location,
      city,
      strategy: "fast",
    });

    const report = {
      event: "canary_geocode",
      mode: "fast",
      locationHint: city ?? null,
      // Never echo the raw location string in logs for privacy — report lengths only.
      locationChars: location.length,
      networkCalls,
      result: {
        status: result.status,
        cached: result.cached,
        precision: result.precision,
        provider: result.provider,
        fallbackApplied: result.fallbackApplied,
        attribution: result.attribution,
        point: result.point,
        warning: result.warning,
      },
      fetchCallsBefore,
    };
    console.log(JSON.stringify(report, null, 2));

    if (result.status !== "ok" || !result.point) {
      throw new Error(`canary geocode fast failed: ${result.status} (${result.warning ?? "no detail"})`);
    }
    if (result.provider !== "city_centroid" && !result.cached) {
      throw new Error(
        `canary geocode fast expected city_centroid or cache, got provider=${result.provider} cached=${result.cached}`,
      );
    }
    if (result.precision !== "city" && !result.cached) {
      throw new Error(`canary geocode fast expected precision=city, got ${result.precision}`);
    }
    if (networkCalls > 0) {
      throw new Error(`canary geocode fast must not hit the network (fetch calls=${networkCalls})`);
    }
    if (result.point.lat < 29 || result.point.lat > 34 || result.point.lng < 34 || result.point.lng > 36) {
      throw new Error("canary geocode point outside expected Israel bounds");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runPreciseCachePath(): Promise<void> {
  const location = process.env.CANARY_GEOCODE_LOCATION?.trim() || "נווה עמל, הרצליה";
  const city = process.env.CANARY_GEOCODE_CITY?.trim() || "הרצליה";

  const first = await resolveGeocodeQuery({ location, city, strategy: "precise" });
  const second = await resolveGeocodeQuery({ location, city, strategy: "precise" });

  const report = {
    event: "canary_geocode",
    mode: "precise",
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

async function main(): Promise<void> {
  const secret = process.env.GEOCODING_CACHE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("GEOCODING_CACHE_SECRET must be set (≥32 bytes)");
  }

  const mode = process.env.CANARY_GEOCODE_MODE?.trim().toLowerCase() || "fast";
  if (mode === "precise") {
    await runPreciseCachePath();
    return;
  }
  await runFastCityFallback();
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
