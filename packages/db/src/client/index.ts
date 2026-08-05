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

    /**
     * Without this listener a dropped IDLE connection is fatal to the process.
     *
     * `pg` emits 'error' on the Pool when a client sitting idle dies, and an
     * 'error' event with no listener is rethrown by Node as an uncaught
     * exception. It is not raised at a query, so no try/catch anywhere can see
     * it. Observed 2026-08-05: every connection from the laibcatalog ingest was
     * reset at once ("read: connection reset by peer"), and a job with hours of
     * work left exited 1 twenty minutes in, taking both of its retries with it.
     *
     * A dropped idle connection is not a failure worth ending a run for. The
     * pool discards the dead client and opens another on the next checkout, so
     * logging and continuing is both correct and what the ingest needs: a
     * six-hour national run must survive a momentary blip from a small Cloud SQL
     * instance under load.
     *
     * Errors that belong to a real query still surface at that query, unchanged.
     */
    pool.on("error", (err) => {
      console.error(
        JSON.stringify({
          severity: "WARNING",
          msg: "idle postgres client dropped; pool will reconnect",
          err: err instanceof Error ? err.message : String(err),
        }),
      );
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
