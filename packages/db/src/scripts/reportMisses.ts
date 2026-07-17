/** Print top misses per kind as markdown + JSON. Usage: tsx src/scripts/reportMisses.ts [limit] */
import { closePool } from "../client/index.js";
import { topMisses, type MissKind } from "../queries/misses.js";

const KINDS: MissKind[] = ["promo_other", "unit_unparseable", "region_unmatched", "ontology_no_hit"];

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 25);
  const out: Record<string, unknown[]> = {};
  for (const kind of KINDS) {
    const rows = await topMisses(kind, limit);
    out[kind] = rows;
    console.log(`\n## ${kind} (top ${rows.length})\n`);
    for (const r of rows) {
      console.log(`- ${r.hit_count}x  ${r.term}  (last ${r.last_seen.toISOString().slice(0, 10)})`);
    }
  }
  console.log("\n<!-- json -->");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .then(async () => closePool().catch(() => undefined))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
