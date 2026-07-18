import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fileConcurrency } from "@super-mcp/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return url;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const conc = fileConcurrency();
    const max = Number.isFinite(conc) ? Math.min(Math.max(20, Math.floor(conc) * 2), 64) : 20;
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // Bound runaway scans on the request path. Migrations exempt themselves
      // via `SET LOCAL statement_timeout = 0` (schema/migrate.ts) because DDL
      // like a large CREATE INDEX is intentionally long-running.
      options: "-c statement_timeout=30000",
    });
  }
  return pool;
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection already dead; the original error is the one that matters.
      }
      throw err;
    }
  });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type { pg };
