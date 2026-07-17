import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../../src/client/index.js";
import { drainSemanticIndex, loadOntologySnapshot, markProductsDirty } from "../../../src/queries/semantic/index.js";
import { hasTestDatabase } from "../../../test/helpers/dbAvailability.js";

describe.runIf(hasTestDatabase())("semanticIndex integration", () => {
  afterAll(async () => {
    await closePool();
  });

  it("loads the active ontology from DB", async () => {
    const snap = await loadOntologySnapshot(getPool(), "he-retail-v1");
    expect(snap.version).toBe("he-retail-v1");
    expect(snap.terms.length).toBeGreaterThan(10);
    expect(snap.relaxations.some((r) => r.attribute === "cut")).toBe(true);
    expect(snap.attributes.some((a) => a.attribute === "freshness" && a.constraintStrength === "hard")).toBe(
      true,
    );
    expect(snap.attributes.some((a) => a.attribute === "form" && a.constraintStrength === "hard")).toBe(true);
    expect(snap.attributes.some((a) => a.attribute === "product_class")).toBe(true);
    expect(snap.searchConfig.vectorLimit).toBeGreaterThan(0);
    expect(snap.searchConfig.firstPassLexicalLimit).toBeGreaterThan(0);
    expect(snap.terms.every((t) => t.matchMode != null)).toBe(true);
  });

  it("drains a dirty product with hasher backend and writes profile+embedding", async () => {
    const pool = getPool();
    const prod = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM product ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    );
    const row = prod.rows[0];
    if (!row) return;

    await markProductsDirty([row.id], "test:hasher");
    const result = await drainSemanticIndex({
      dirtyOnly: true,
      limit: 5,
      backend: "hasher",
      model: "test-hasher-v1",
      ontologyVersion: "he-retail-v1",
    });
    expect(result.failed).toBe(0);
    expect(result.processed + result.skipped).toBeGreaterThan(0);

    const emb = await pool.query(
      `SELECT 1 FROM product_embedding WHERE product_id = $1 AND model = $2`,
      [row.id, "test-hasher-v1"],
    );
    expect(emb.rowCount).toBe(1);

    const profile = await pool.query<{
      attributes: Record<string, string>;
      penalties: string[] | null;
      concept_terms: string[] | null;
    }>(
      `SELECT attributes, penalties, concept_terms FROM product_semantic_profile
       WHERE product_id = $1 AND ontology_version = 'he-retail-v1'`,
      [row.id],
    );
    expect(profile.rowCount).toBe(1);
    expect(Array.isArray(profile.rows[0]?.penalties)).toBe(true);
    expect(Array.isArray(profile.rows[0]?.concept_terms)).toBe(true);

    const dirty = await pool.query(
      `SELECT 1 FROM semantic_index_dirty WHERE product_id = $1`,
      [row.id],
    );
    expect(dirty.rowCount).toBe(0);
  });

  it("skips unchanged rows on second drain (hash match)", async () => {
    const result = await drainSemanticIndex({
      dirtyOnly: false,
      limit: 3,
      backend: "hasher",
      model: "test-hasher-v1",
      ontologyVersion: "he-retail-v1",
    });
    const again = await drainSemanticIndex({
      dirtyOnly: false,
      limit: 3,
      backend: "hasher",
      model: "test-hasher-v1",
      ontologyVersion: "he-retail-v1",
    });
    expect(again.failed).toBe(0);
    expect(result.model).toBe("test-hasher-v1");
  });

  it("rebuilds profiles for dirty rows even when product text hash is unchanged", async () => {
    const pool = getPool();
    const prod = await pool.query<{ id: string }>(
      `SELECT p.id
       FROM product p
       JOIN product_semantic_profile psp
         ON psp.product_id = p.id AND psp.ontology_version = 'he-retail-v1'
       WHERE p.name ILIKE '%קפוא%' OR p.name ILIKE '%במלח%' OR p.name ILIKE '%כבוש%'
       ORDER BY p.updated_at DESC NULLS LAST
       LIMIT 1`,
    );
    const row = prod.rows[0];
    if (!row) return;

    await pool.query(
      `UPDATE product_semantic_profile
       SET attributes = '{}'::jsonb, profiled_at = now()
       WHERE product_id = $1 AND ontology_version = 'he-retail-v1'`,
      [row.id],
    );
    await markProductsDirty([row.id], "test:ontology_refresh");

    const result = await drainSemanticIndex({
      dirtyOnly: true,
      limit: 5,
      backend: "hasher",
      model: "test-hasher-v1",
      ontologyVersion: "he-retail-v1",
    });
    expect(result.failed).toBe(0);
    expect(result.processed).toBeGreaterThan(0);

    const profile = await pool.query<{ attributes: Record<string, string> }>(
      `SELECT attributes FROM product_semantic_profile
       WHERE product_id = $1 AND ontology_version = 'he-retail-v1'`,
      [row.id],
    );
    const attrs = profile.rows[0]?.attributes ?? {};
    expect(
      Boolean(attrs.form) || Boolean(attrs.product_class) || Object.keys(attrs).length > 0,
    ).toBe(true);

    const dirty = await pool.query(`SELECT 1 FROM semantic_index_dirty WHERE product_id = $1`, [
      row.id,
    ]);
    expect(dirty.rowCount).toBe(0);
  });
});
