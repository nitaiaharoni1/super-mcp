import { closePool, getPool } from "../client/index.js";

/**
 * Demote `waste_bags` to NULL where the product name never says so.
 *
 * The classifier cannot hold this one line. Given the `disposables` family it
 * anchors on the word "שקיות" and files carrier bags, checkout bags, branded
 * bags and even a wipes bucket as bin liners: measured on production, only 43.5%
 * of 499 `waste_bags` products had אשפה or זבל anywhere in the name, while
 * `tableware_disposable`, `foil_wrap` and `food_storage_bags` were clean. An
 * explicit prompt rule naming the distinction did not move it.
 *
 * So the label is corrected rather than trusted. This only ever REMOVES a label,
 * which is the safe direction the classifier already documents: an unlabelled
 * product reads as unknown, and the peer query matches `class_l3 = $n`, so a
 * NULL can no longer be substituted into a bin-liner line. A wrongly labelled
 * one gets delivered to somebody instead of the bin liners they asked for.
 *
 * Name-based, which this codebase rightly distrusts. It earns the exception by
 * being one-directional: no product gains a label here, and the worst case is a
 * genuine bin liner that names itself obscurely losing its L3 and falling back
 * to L2 grouping, which is exactly where it was before.
 *
 * Re-run after every classification pass, alongside seedConceptAliases.
 *
 *   --dry-run   report what would change and write nothing
 */
const WASTE_MARKERS = ["אשפה", "זבל", "לפח", "אשפתון"];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getPool();

  const nameMatches = WASTE_MARKERS.map((_, i) => `p.name LIKE '%' || $${i + 1} || '%'`).join(
    " OR ",
  );

  const { rows: before } = await pool.query<{ total: string; keep: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE ${nameMatches}) AS keep
       FROM product p JOIN product_class_map m ON m.product_id = p.id
      WHERE m.class_l3 = 'waste_bags'`,
    WASTE_MARKERS,
  );
  const total = Number(before[0]?.total ?? 0);
  const keep = Number(before[0]?.keep ?? 0);
  console.log(`[prune] waste_bags: ${total} labelled, ${keep} named like waste, ${total - keep} to demote`);

  if (!dryRun && total - keep > 0) {
    const { rowCount } = await pool.query(
      `UPDATE product_class_map m SET class_l3 = NULL
         FROM product p
        WHERE m.product_id = p.id AND m.class_l3 = 'waste_bags'
          AND NOT (${nameMatches})`,
      WASTE_MARKERS,
    );
    console.log(`[prune] demoted ${rowCount} rows to class_l3 = NULL`);
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
