import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "@super-mcp/db";
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
