/**
 * CLI to create an API key.
 * Usage: create-key --name=foo [--role=standard|master] [--expires-at=<ISO timestamp>]
 * Prints the raw key once; only its sha256 hash is stored.
 */
import { closePool } from "@super-mcp/db";
import { parseCreateKeyArgs } from "./keyCli.js";
import { createApiKey } from "./services/apiKeys.js";

async function main(): Promise<void> {
  const args = parseCreateKeyArgs(process.argv.slice(2));
  const created = await createApiKey(args, null);

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...created,
        hint: "Store this key now; only its sha256 hash is kept server-side. Use as: Authorization: Bearer <apiKey>",
      },
      null,
      2,
    ),
  );
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
