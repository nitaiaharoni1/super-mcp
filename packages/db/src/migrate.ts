import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate(): Promise<void> {
  const pool = getPool();
  const dir = path.join(__dirname, "migrations");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

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
      console.log(`skip ${id}`);
      continue;
    }
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
      await client.query("COMMIT");
      console.log(`applied ${id}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(async () => {
    await closePool();
    console.log("migrations complete");
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
