import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "@super-mcp/db";
import { getAdapters } from "./adapters/index.js";
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
  const results = [];
  for (const adapter of adapters) {
    console.log(`Running ingestion for ${adapter.sourceId}...`);
    const result = await runPipeline(adapter);
    results.push(result);
    console.log(JSON.stringify(result, null, 2));
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
