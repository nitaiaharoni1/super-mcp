/**
 * Manual trigger for the g/ml unit-family self-heal (a bottle named "1.5 ליטר"
 * stored as 1500 g → 1500 ml). Ingestion runs this automatically at the end of
 * every run; use this to heal on demand without a full ingest.
 *
 * Usage:
 *   pnpm --filter @super-mcp/api exec tsx src/scripts/fixSizeUnitFamily.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool, healSizeUnitFamily } from "@super-mcp/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function main() {
  const result = await healSizeUnitFamily();
  console.log(JSON.stringify({ event: "heal_size_unit_family", ...result }));
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
