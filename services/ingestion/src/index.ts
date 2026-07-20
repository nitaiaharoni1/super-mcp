import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { backfillCentroids, closePool, healSizeUnitFamily } from "@super-mcp/db";
import { getAdapters } from "./sources/index.js";
import { runPipeline } from "./pipeline.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(rootDir, ".env") });

function parseArgs(argv: string[]): { source: string } {
  let source = "fixture";
  for (const arg of argv) {
    if (arg === "--fixture") source = "fixture";
    if (arg.startsWith("--source=")) source = arg.slice("--source=".length);
  }
  return { source };
}

async function main(): Promise<void> {
  const { source } = parseArgs(process.argv.slice(2));
  const adapters = getAdapters(source);
  // Independent sources (Shufersal / Cerberus / Carrefour) can run together.
  // Per-file parallelism inside each pipeline is controlled by SUPER_MCP_CONCURRENCY.
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      console.log(`Running ingestion for ${adapter.sourceId}...`);
      const result = await runPipeline(adapter);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }),
  );
  // Self-heal g/ml unit-family corruption catalog-wide (idempotent) so each run
  // leaves stored sizes consistent with product names, including stragglers not
  // in this feed slice. Never let a maintenance hiccup fail the whole ingest.
  try {
    const heal = await healSizeUnitFamily();
    console.log(JSON.stringify({ event: "heal_size_unit_family", ...heal }));
  } catch (err) {
    console.error("heal_size_unit_family failed (non-fatal):", err);
  }

  // Stamp any store still missing coordinates (new branches, or ones whose
  // address just changed and were reset for re-geocoding) with its city
  // centroid. Offline and idempotent, so every ingest leaves stores locatable at
  // least city-level; the address-precision upgrade runs separately (geocode
  // script) and is never undone by this pass, which only touches NULL coords.
  try {
    const geo = await backfillCentroids();
    console.log(JSON.stringify({ event: "geocode_centroid", ...geo }));
  } catch (err) {
    console.error("geocode_centroid backfill failed (non-fatal):", err);
  }

  // Exit 1 only when every adapter failed with zero successful rows.
  const hardFail = results.every((r) => r.status === "failed" && r.rowsOk === 0);
  await closePool();
  process.exit(hardFail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
