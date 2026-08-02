/**
 * Stamp store.in_coverage using the SAME predicate the ingest uses.
 *
 * Lives in the ingestion service on purpose: isStoreInIngestRegion() is the
 * authority on what the ingest refreshes, and re-implementing that test in SQL
 * (or anywhere else) would let the flag drift away from reality, which is exactly
 * the failure mode that made a two-store cap look like a healthy national run.
 *
 *   pnpm --filter @super-mcp/ingestion exec tsx src/scripts/markStoreCoverage.ts [--dry-run]
 */
import { closePool, getPool } from "@super-mcp/db";
import { isStoreInIngestRegion, regionFilterEnabled } from "../regions.js";

interface Row {
  id: string;
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  store_code: string;
  in_coverage: boolean | null;
  is_delivery_storefront: boolean;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getPool();

  if (!regionFilterEnabled()) {
    // With the filter off the ingest refreshes everything, so nothing is out of
    // scope and marking stores would hide branches that do get updated.
    console.log(
      JSON.stringify({
        event: "store_coverage_skipped",
        reason: "SUPER_MCP_REGION_FILTER=0, every store is in coverage",
      }),
    );
    await closePool();
    return;
  }

  const { rows } = await pool.query<Row>(
    `SELECT s.id, s.name, s.city, s.lat, s.lng, s.store_code, s.in_coverage,
            EXISTS (
              SELECT 1 FROM fulfillment_service fs
               WHERE fs.store_id = s.id AND fs.active
            ) AS is_delivery_storefront
       FROM store s`,
  );

  let inCoverage = 0;
  let outOfCoverage = 0;
  let changed = 0;
  const outSample: string[] = [];

  for (const row of rows) {
    const covered = isStoreInIngestRegion({
      storeId: row.store_code,
      city: row.city ?? undefined,
      lat: row.lat ?? undefined,
      lng: row.lng ?? undefined,
      name: row.name,
      isDeliveryStorefront: row.is_delivery_storefront,
    });
    if (covered) inCoverage += 1;
    else {
      outOfCoverage += 1;
      if (outSample.length < 8) outSample.push(`${row.name} (${row.city ?? "no city"})`);
    }
    if (row.in_coverage !== covered) {
      changed += 1;
      if (!dryRun) {
        await pool.query(`UPDATE store SET in_coverage = $1, updated_at = now() WHERE id = $2`, [
          covered,
          row.id,
        ]);
      }
    }
  }

  console.log(
    JSON.stringify({
      event: "store_coverage_marked",
      dryRun,
      scanned: rows.length,
      inCoverage,
      outOfCoverage,
      changed,
      outOfCoverageSample: outSample,
    }),
  );
  await closePool();
}

await main();
