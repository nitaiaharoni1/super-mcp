import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "../client/index.js";
import { checkCatalogIntegrity } from "../queries/integrity.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: path.join(rootDir, ".env") });

async function main(): Promise<void> {
  const report = await checkCatalogIntegrity();
  console.log(JSON.stringify(report, null, 2));
  await closePool();
  process.exit(report.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
