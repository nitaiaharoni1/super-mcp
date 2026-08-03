import { L3_QUERY_PHRASES } from "@super-mcp/shared";
import { closePool, getPool } from "../client/index.js";

/**
 * Register each concept's everyday Hebrew as a searchable alias of every product
 * the classifier filed under it.
 *
 * The read side already narrows a candidate pool to the L3 a query names, but
 * narrowing cannot retrieve: a "שקיות זבל" search returns whatever shares the
 * word "שקיות", and the bin liners the shopper meant are filed under "אשפה", so
 * they never enter the pool to be narrowed to. Search already joins
 * `product_alias` for candidates, so writing the concept's words against the
 * classified products is what actually puts them in front of the ranker.
 *
 * Derived from the classification rather than hand-maintained per product: a
 * re-run picks up every newly labelled SKU for free. Rows carry source
 * 'concept' so they can be re-derived without touching curated aliases.
 *
 *   --dry-run   report the counts and write nothing
 */
const SOURCE = "concept";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getPool();

  let totalPairs = 0;
  const perConcept: Array<{ l3: string; products: number; phrases: number }> = [];

  // Authoritative, not additive. These rows are DERIVED from the classification,
  // so a product that loses its L3 must lose the concept's words with it.
  // Insert-only left 452 demoted products still answering to "שקיות זבל" in
  // production, which is exactly how a cloth carrier bag reached the ranker for
  // a bin-liner line. Only source='concept' is touched; curated aliases are not
  // ours to delete.
  //
  // The clear and the rewrite share one transaction. Apart they are a window in
  // which search has lost every derived alias, and a crash midway leaves it that
  // way: the bin liners silently stop being findable by the word the shopper
  // actually types, with nothing failing loudly to say so.
  const client = dryRun ? null : await pool.connect();
  if (client) {
    await client.query("BEGIN");
    const { rowCount } = await client.query(`DELETE FROM product_alias WHERE source = $1`, [SOURCE]);
    console.log(`[alias] cleared ${rowCount} previously derived rows`);
  }

  try {
  for (const [l3, phrases] of Object.entries(L3_QUERY_PHRASES)) {
    const { rows } = await pool.query<{ product_id: string }>(
      `SELECT product_id FROM product_class_map WHERE class_l3 = $1`,
      [l3],
    );
    if (rows.length === 0) continue;
    perConcept.push({ l3, products: rows.length, phrases: phrases.length });
    totalPairs += rows.length * phrases.length;

    if (dryRun) continue;

    // One statement per phrase, unnesting the product ids. ON CONFLICT DO
    // NOTHING makes the whole script idempotent, so it is safe to re-run after
    // every classification pass.
    for (const alias of phrases) {
      await client!.query(
        `INSERT INTO product_alias (product_id, alias, locale, source)
         SELECT unnest($1::uuid[]), $2, 'he', $3
         ON CONFLICT (alias, product_id) DO NOTHING`,
        [rows.map((r: { product_id: string }) => r.product_id), alias, SOURCE],
      );
    }
  }
    if (client) await client.query("COMMIT");
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    throw err;
  } finally {
    client?.release();
  }

  for (const c of perConcept) {
    console.log(`[alias] ${c.l3}: ${c.products} products x ${c.phrases} phrases`);
  }
  console.log(`[alias] ${dryRun ? "would write" : "wrote"} up to ${totalPairs} alias pairs`);

  if (!dryRun) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM product_alias WHERE source = $1`,
      [SOURCE],
    );
    console.log(`[alias] product_alias rows with source=${SOURCE}: ${rows[0]?.n}`);
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
