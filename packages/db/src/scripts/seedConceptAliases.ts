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

/**
 * A product priced this many times its concept's median is not answering the
 * plain word, whatever the classifier decided.
 *
 * Writing the concept's everyday Hebrew against a product asserts something
 * specific: that it is a plausible answer to that bare word. The classifier is
 * good at the shelf a thing belongs on and reliably bad at the device/consumable
 * line, so it filed electric toothbrushes under toothpaste, a coffee machine and
 * several eau de toilettes under instant coffee, decorative bins under bin bags
 * and catering cases of toilet paper alongside a household four-pack. Each then
 * inherited the plain word and could be picked for it: a measured basket priced
 * "נייר טואלט" at Shufersal as a 350 shekel case and reported the chain at 460
 * instead of 136, which is enough to invert the ranking the whole product exists
 * to give.
 *
 * Price is the cheap, language-independent signal for that mistake, and it works
 * because the failure is always the same shape: the thing that dispenses or
 * holds the everyday item costs many times the everyday item. The guard belongs
 * here rather than in the classification, because the classification is often
 * defensible on its own terms (a 130 shekel bath oil really is a body wash) and
 * it is only the claim "type this word and mean this" that does not survive.
 *
 * Deliberately loose. At 8x it also drops premium-but-genuine members of a
 * concept, and that is the correct direction to err: losing one expensive way to
 * answer "sabon rechitsa" costs a shopper nothing, since cheaper real ones
 * remain, while keeping one 866 shekel toothbrush under "mishchat shinayim"
 * ruins a basket.
 */
const OUTLIER_PRICE_RATIO = 8;
/** Concepts thinner than this have no median worth trusting, so leave them be. */
const MIN_CONCEPT_SAMPLE = 20;

/**
 * Products whose cheapest price is an extreme outlier for their own L3.
 * Computed once and applied to every concept, so the cost is one query.
 */
async function outlierProductIds(
  pool: Pick<ReturnType<typeof getPool>, "query">,
): Promise<Set<string>> {
  const { rows } = await pool.query<{ product_id: string }>(
    `WITH priced AS (
       SELECT p.id AS product_id, pcm.class_l3, min(sp.price) AS price
         FROM product p
         JOIN product_class_map pcm ON pcm.product_id = p.id
         JOIN listing l ON l.product_id = p.id
         JOIN store_price sp ON sp.listing_id = l.id
        WHERE pcm.class_l3 IS NOT NULL AND sp.price > 0
        GROUP BY p.id, pcm.class_l3
     ), stats AS (
       SELECT class_l3,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::numeric AS median
         FROM priced
        GROUP BY class_l3
       HAVING count(*) >= $2
     )
     SELECT priced.product_id
       FROM priced JOIN stats USING (class_l3)
      WHERE priced.price > stats.median * $1`,
    [OUTLIER_PRICE_RATIO, MIN_CONCEPT_SAMPLE],
  );
  return new Set(rows.map((r) => r.product_id));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getPool();

  let totalPairs = 0;
  let totalSkipped = 0;
  const perConcept: Array<{ l3: string; products: number; phrases: number }> = [];

  const outliers = await outlierProductIds(pool);
  console.log(`[alias] ${outliers.size} price-outlier products will not receive concept words`);

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
    const { rows: classified } = await pool.query<{ product_id: string }>(
      `SELECT product_id FROM product_class_map WHERE class_l3 = $1`,
      [l3],
    );
    const rows = classified.filter((r) => !outliers.has(r.product_id));
    totalSkipped += classified.length - rows.length;
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
  console.log(`[alias] skipped ${totalSkipped} product/concept pairs as price outliers`);

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
