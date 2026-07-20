import { closePool, getPool } from "../client/index.js";

/**
 * Correct known product_class_map mislabels:
 *   1. Watermelon: names that are exactly / start with אבטיח → class_l3=watermelon
 *      (LLM often collapses them into melon).
 *   2. Turkish / ground coffee: coffee names containing טורקי that are NOT
 *      instant (no נמס / טייסטרס) → class_l3=ground_coffee.
 *
 * Flags:
 *   --dry-run   print planned updates, skip writes
 *   --apply     write updates (default is dry-run)
 */

interface Args {
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
  }
  return { apply };
}

/** Produce rows whose name is watermelon fruit, not melon / flavored candy. */
const WATERMELON_WHERE = `
  class_l2 = 'fruit_fresh'
  AND COALESCE(class_l3, '') = 'melon'
  AND input_name ~ 'אבטיח'
  AND input_name !~ 'מלון'
  AND input_name !~ 'מאגדת'
  AND input_name !~ 'גליד'
  AND input_name !~ 'לקריץ'
  AND input_name !~ 'ליקריץ'
  AND input_name !~ 'קרחון'
`;

async function fixWatermelons(apply: boolean): Promise<number> {
  const pool = getPool();
  const preview = await pool.query<{ product_id: string; input_name: string; class_l3: string | null }>(
    `SELECT product_id, input_name, class_l3
       FROM product_class_map
      WHERE ${WATERMELON_WHERE}`,
  );
  console.log(
    JSON.stringify({
      event: "fix_watermelon_preview",
      count: preview.rows.length,
      samples: preview.rows.slice(0, 20),
    }),
  );
  if (!apply || preview.rows.length === 0) return preview.rows.length;

  const res = await pool.query(
    `UPDATE product_class_map
        SET class_l3 = 'watermelon',
            class_l2 = 'fruit_fresh',
            class_l1 = COALESCE(NULLIF(class_l1, ''), 'produce'),
            classified_at = now()
      WHERE ${WATERMELON_WHERE}`,
  );
  return res.rowCount ?? 0;
}

async function fixTurkishCoffee(apply: boolean): Promise<number> {
  const pool = getPool();
  // Coffee rows with טורקי that look ground/Turkish, not instant.
  const preview = await pool.query<{
    product_id: string;
    input_name: string;
    class_l3: string | null;
  }>(
    `SELECT product_id, input_name, class_l3
       FROM product_class_map
      WHERE input_name ~ 'טורקי'
        AND input_name !~ 'נמס'
        AND input_name !~ 'טייסטרס'
        AND input_name !~ 'טסטרס'
        AND input_name !~ 'קפסול'
        AND input_name !~* 'capsule'
        AND (
          class_l2 = 'coffee'
          OR class_l3 IN ('instant_coffee', 'coffee_beans', 'coffee_capsule', 'ground_coffee')
        )
        AND COALESCE(class_l3, '') <> 'ground_coffee'`,
  );
  console.log(
    JSON.stringify({
      event: "fix_turkish_coffee_preview",
      count: preview.rows.length,
      samples: preview.rows.slice(0, 20),
    }),
  );
  if (!apply || preview.rows.length === 0) return preview.rows.length;

  const res = await pool.query(
    `UPDATE product_class_map
        SET class_l3 = 'ground_coffee',
            class_l2 = 'coffee',
            class_l1 = COALESCE(NULLIF(class_l1, ''), 'beverage'),
            classified_at = now()
      WHERE input_name ~ 'טורקי'
        AND input_name !~ 'נמס'
        AND input_name !~ 'טייסטרס'
        AND input_name !~ 'טסטרס'
        AND input_name !~ 'קפסול'
        AND input_name !~* 'capsule'
        AND (
          class_l2 = 'coffee'
          OR class_l3 IN ('instant_coffee', 'coffee_beans', 'coffee_capsule', 'ground_coffee')
        )
        AND COALESCE(class_l3, '') <> 'ground_coffee'`,
  );
  return res.rowCount ?? 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const watermelon = await fixWatermelons(args.apply);
  const turkishCoffee = await fixTurkishCoffee(args.apply);
  console.log(
    JSON.stringify({
      event: "fix_product_classes",
      mode: args.apply ? "apply" : "dry-run",
      watermelonUpdated: watermelon,
      turkishCoffeeUpdated: turkishCoffee,
    }),
  );
  await closePool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await closePool();
  process.exit(1);
});
