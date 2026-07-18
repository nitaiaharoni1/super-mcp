import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RunMigrationsOptions {
  /** Directory containing numbered `.sql` migration files. */
  migrationsDir?: string;
  /** Called after each migration is applied or skipped. */
  onProgress?: (event: { type: "applied" | "skipped"; id: string }) => void;
}

export interface RunMigrationsResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply pending SQL migrations in lexical order inside a transaction per file.
 */
export async function runMigrations(
  pool: pg.Pool,
  opts: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const dir = opts.migrationsDir ?? path.join(__dirname, "../migrations");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  for (const file of files) {
    const id = file;
    const existing = await pool.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [id]);
    if ((existing.rowCount ?? 0) > 0) {
      skipped.push(id);
      opts.onProgress?.({ type: "skipped", id });
      continue;
    }

    const sql = await fs.readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // DDL (CREATE INDEX on large tables, ALTER) is admin-initiated and can
      // legitimately run for minutes; exempt migrations from the pool's
      // API-oriented statement_timeout so a big index build isn't killed.
      await client.query("SET LOCAL statement_timeout = 0");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
      await client.query("COMMIT");
      applied.push(id);
      opts.onProgress?.({ type: "applied", id });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection already dead; the original error is the one that matters.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}
