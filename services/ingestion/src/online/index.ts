import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool, refreshProductStoreCounts } from "@super-mcp/db";
import { runPipeline } from "../pipeline.js";
import {
  ONLINE_SOURCE_IDS,
  getOnlineAdapters,
  type OnlineSourceId,
  type OnlineSourceOptions,
} from "./sources/index.js";
import { syncScrapedFulfillment } from "./fulfillmentFromScrape.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: path.join(rootDir, ".env") });

/**
 * The online ingest, deliberately a separate entry point from the feed ingest.
 *
 * It shares the normalisation and persistence pipeline, because product identity,
 * unit handling and price upserts are the same problem whatever the source. What
 * it does NOT share is the schedule, the health status or the provenance: a
 * regulated feed that goes quiet is an incident, whereas a website that changes
 * its markup is a Tuesday, and mixing the two makes the alert on the first one
 * useless.
 *
 *   pnpm ingest:online
 *   pnpm ingest:online -- --sources=wolt
 *   pnpm ingest:online -- --sources=wolt --venues=wolt-market,am-pm --max-venues=6
 *   pnpm ingest:online -- --sources=storai --max-queries=60
 */
interface OnlineArgs {
  sources: OnlineSourceId[];
  options: OnlineSourceOptions;
}

function parseArgs(argv: string[]): OnlineArgs {
  let sources: OnlineSourceId[] = [];
  const wolt: NonNullable<OnlineSourceOptions["wolt"]> = {};
  const storai: NonNullable<OnlineSourceOptions["storai"]> = {};

  for (const arg of argv) {
    if (arg.startsWith("--sources=")) {
      const names = arg
        .slice("--sources=".length)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const unknown = names.filter((n) => !ONLINE_SOURCE_IDS.includes(n as OnlineSourceId));
      // A typo that silently ingests nothing and exits 0 is a failure this
      // codebase has already been bitten by once, on the Cerberus chain filter.
      if (unknown.length > 0) {
        throw new Error(
          `Unknown online source(s): ${unknown.join(", ")}. Valid: ${ONLINE_SOURCE_IDS.join(", ")}`,
        );
      }
      sources = names as OnlineSourceId[];
    }
    if (arg.startsWith("--venues=")) {
      wolt.venueFilter = arg.slice("--venues=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (arg.startsWith("--max-venues=")) {
      wolt.maxVenues = Number(arg.slice("--max-venues=".length));
    }
    if (arg.startsWith("--max-categories=")) {
      wolt.maxCategoriesPerVenue = Number(arg.slice("--max-categories=".length));
    }
    if (arg.startsWith("--max-queries=")) {
      storai.maxQueriesPerBranch = Number(arg.slice("--max-queries=".length));
    }
  }
  return { sources, options: { wolt, storai } };
}

async function main(): Promise<void> {
  const { sources, options } = parseArgs(process.argv.slice(2));
  const adapters = getOnlineAdapters(sources, options);

  console.log(
    JSON.stringify({
      event: "online_ingest_start",
      sources: adapters.map((a) => a.sourceId),
    }),
  );

  // Sequential, unlike the feed ingest which runs its sources concurrently.
  // These are other people's websites: two of our own jobs hammering them at
  // once is both rude and the fastest way to get the source blocked.
  const results = [];
  for (const adapter of adapters) {
    console.log(`Running online ingestion for ${adapter.sourceId}...`);
    const result = await runPipeline(adapter);
    console.log(JSON.stringify(result, null, 2));
    results.push(result);
  }

  // Wolt publishes its delivery terms and service polygon in the same payload as
  // its prices, so unlike every chain in the curated catalogue these need no
  // human to re-read them. Derive them straight from what we just ingested.
  try {
    const fulfillment = await syncScrapedFulfillment();
    console.log(JSON.stringify({ event: "scraped_fulfillment_sync", ...fulfillment }));
  } catch (err) {
    console.error("scraped fulfillment sync failed (non-fatal):", err);
  }

  try {
    const counts = await refreshProductStoreCounts();
    console.log(JSON.stringify({ event: "product_store_counts", ...counts }));
  } catch (err) {
    console.error("product_store_counts refresh failed (non-fatal):", err);
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
