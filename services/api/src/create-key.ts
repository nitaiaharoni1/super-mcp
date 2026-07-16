/**
 * CLI to create an API key.
 * Usage: pnpm --filter @super-mcp/api create-key -- --name=foo [--rate-limit-per-minute=60]
 * Prints the raw key once; only its sha256 hash is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { closePool, query } from "@super-mcp/db";

interface Args {
  name: string;
  rateLimitPerMinute: number;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (match) {
      const [, key, value] = match;
      if (key) flags[key] = value ?? "";
    }
  }

  const name = flags.name;
  if (!name) {
    console.error("Usage: create-key --name=<name> [--rate-limit-per-minute=60]");
    process.exit(1);
  }

  const rateLimitPerMinute = flags["rate-limit-per-minute"] ? Number(flags["rate-limit-per-minute"]) : 60;
  return { name, rateLimitPerMinute };
}

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function main(): Promise<void> {
  const { name, rateLimitPerMinute } = parseArgs(process.argv.slice(2));

  const rawKey = `smcp_${randomBytes(24).toString("hex")}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = sha256Hex(rawKey);

  const res = await query<{ id: string }>(
    `INSERT INTO api_key (name, key_hash, key_prefix, rate_limit_per_minute)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [name, keyHash, keyPrefix, rateLimitPerMinute],
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: res.rows[0]?.id,
        name,
        rateLimitPerMinute,
        apiKey: rawKey,
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
