import { closePool } from "@super-mcp/db";
import { syncFulfillmentCatalog } from "../fulfillment/sync.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await syncFulfillmentCatalog({ dryRun });

  console.log(
    JSON.stringify(
      {
        event: "fulfillment_catalog_sync",
        dryRun,
        written: result.written,
        deactivated: result.deactivated,
        skippedMissingStore: result.skippedMissingStore,
      },
      null,
      2,
    ),
  );

  // A storefront in the catalogue with no store row prices nothing, so it is
  // worth a non-zero exit in CI rather than a line nobody reads.
  if (result.skippedMissingStore.length > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
