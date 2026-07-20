import { closePool, getPool, withTransaction } from "../client/index.js";
import {
  pickListingsToQuarantine,
  sourceKeyForListing,
  type GtinConflict,
  type ListingConflictSide,
} from "./lib/gtinConflict.js";

/**
 * Detect cross-chain GTIN merges where listing names (or class_l1) diverge, and
 * quarantine mismatched listings onto new chain-scoped non-GTIN products.
 *
 * For each conflict listing:
 *   - INSERT product (gtin=NULL, source_key=chain:item_code, name=listing.name)
 *   - UPDATE listing SET product_id=new, is_gtin=false
 * The original GTIN product keeps the best-matching listing(s).
 *
 * Flags:
 *   --dry-run              detect only (default)
 *   --apply                write quarantines
 *   --gtin=A,B             limit to these GTINs
 *   --severe-only          only sim < severe threshold (or class+name mismatch)
 *   --name-threshold=0.2   conflict threshold
 *   --severe-threshold=0.1 severe threshold
 *   --all-severe           scan all multi-chain GTINs; quarantine severe (sim < 0.1)
 *   --require-class-mismatch
 *                          for bulk scans, only quarantine when both class_l1
 *                          values exist and differ (avoids Nature-Valley-style
 *                          brand synonym false positives)
 *
 * Default (no --gtin): known bad GTINs 7290000000465, 7290000001459.
 */

interface Args {
  apply: boolean;
  gtins: string[] | null;
  severeOnly: boolean;
  nameThreshold: number;
  severeThreshold: number;
  allSevere: boolean;
  requireClassMismatch: boolean;
}

const KNOWN_BAD_GTINS = ["7290000000465", "7290000001459"];

function parseArgs(argv: string[]): Args {
  let apply = false;
  let gtins: string[] | null = null;
  let severeOnly = false;
  let nameThreshold = 0.2;
  let severeThreshold = 0.1;
  let allSevere = false;
  let requireClassMismatch = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--severe-only") severeOnly = true;
    else if (arg === "--all-severe") allSevere = true;
    else if (arg === "--require-class-mismatch") requireClassMismatch = true;
    else if (arg.startsWith("--gtin=")) {
      gtins = arg
        .slice("--gtin=".length)
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--name-threshold=")) {
      nameThreshold = Number(arg.slice("--name-threshold=".length));
    } else if (arg.startsWith("--severe-threshold=")) {
      severeThreshold = Number(arg.slice("--severe-threshold=".length));
    }
  }
  return { apply, gtins, severeOnly, nameThreshold, severeThreshold, allSevere, requireClassMismatch };
}

async function loadSides(gtins: string[] | null): Promise<Map<string, ListingConflictSide[]>> {
  const pool = getPool();
  // Full-catalog scans need a longer timeout than the request-path default (30s).
  await pool.query("SET statement_timeout = '120s'");
  const params: unknown[] = [];
  let gtinFilter = "";
  if (gtins && gtins.length > 0) {
    params.push(gtins);
    gtinFilter = `AND p.gtin = ANY($${params.length}::text[])`;
  }

  const res = await pool.query<{
    listing_id: string;
    chain_id: string;
    item_code: string;
    listing_name: string;
    product_id: string;
    product_name: string;
    gtin: string;
    listing_class_l1: string | null;
    product_class_l1: string | null;
  }>(
    `WITH multi AS (
       SELECT p.id, p.gtin, p.name AS product_name
         FROM product p
         JOIN listing l ON l.product_id = p.id
        WHERE p.gtin IS NOT NULL
          ${gtinFilter}
        GROUP BY p.id, p.gtin, p.name
       HAVING count(DISTINCT l.chain_id) > 1
     ),
     product_class AS (
       SELECT DISTINCT ON (m.product_id) m.product_id, m.class_l1
         FROM product_class_map m
         JOIN multi x ON x.id = m.product_id AND m.input_name = x.product_name
        ORDER BY m.product_id, m.classified_at DESC NULLS LAST
     ),
     listing_class AS (
       SELECT DISTINCT ON (m.input_name) m.input_name, m.class_l1
         FROM product_class_map m
         JOIN listing l ON l.name = m.input_name
         JOIN multi x ON x.id = l.product_id
        ORDER BY m.input_name, m.classified_at DESC NULLS LAST
     )
     SELECT l.id AS listing_id,
            l.chain_id,
            l.item_code,
            l.name AS listing_name,
            p.id AS product_id,
            p.product_name,
            p.gtin,
            lc.class_l1 AS listing_class_l1,
            pc.class_l1 AS product_class_l1
       FROM multi p
       JOIN listing l ON l.product_id = p.id
       LEFT JOIN product_class pc ON pc.product_id = p.id
       LEFT JOIN listing_class lc ON lc.input_name = l.name
      ORDER BY p.gtin, l.chain_id, l.item_code`,
    params,
  );

  const byGtin = new Map<string, ListingConflictSide[]>();
  for (const row of res.rows) {
    const side: ListingConflictSide = {
      listingId: row.listing_id,
      chainId: row.chain_id,
      itemCode: row.item_code,
      listingName: row.listing_name,
      productId: row.product_id,
      productName: row.product_name,
      productGtin: row.gtin,
      listingClassL1: row.listing_class_l1,
      productClassL1: row.product_class_l1,
    };
    const list = byGtin.get(row.gtin) ?? [];
    list.push(side);
    byGtin.set(row.gtin, list);
  }
  return byGtin;
}

async function quarantineListing(conflict: GtinConflict): Promise<{ newProductId: string }> {
  return withTransaction(async (client) => {
    const sourceKey = sourceKeyForListing(conflict.chainId, conflict.itemCode);

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM product WHERE source_key = $1`,
      [sourceKey],
    );
    let newProductId = existing.rows[0]?.id;
    if (!newProductId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO product (gtin, source_key, name)
         VALUES (NULL, $1, $2)
         RETURNING id`,
        [sourceKey, conflict.listingName],
      );
      newProductId = inserted.rows[0]!.id;
    } else {
      await client.query(`UPDATE product SET name = $2, updated_at = now() WHERE id = $1`, [
        newProductId,
        conflict.listingName,
      ]);
    }

    await client.query(
      `UPDATE listing
          SET product_id = $2,
              is_gtin = false,
              updated_at = now()
        WHERE id = $1`,
      [conflict.listingId, newProductId],
    );

    return { newProductId };
  });
}

function detectConflicts(
  byGtin: Map<string, ListingConflictSide[]>,
  opts: {
    nameThreshold: number;
    severeThreshold: number;
    severeOnly: boolean;
    requireClassMismatch?: boolean;
  },
): GtinConflict[] {
  const all: GtinConflict[] = [];
  for (const sides of byGtin.values()) {
    all.push(
      ...pickListingsToQuarantine(sides, {
        nameThreshold: opts.nameThreshold,
        severeThreshold: opts.severeThreshold,
        severeOnly: opts.severeOnly,
      }),
    );
  }
  if (!opts.requireClassMismatch) return all;
  return all.filter(
    (c) =>
      c.classL1Listing != null &&
      c.classL1Product != null &&
      c.classL1Listing !== c.classL1Product,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let conflicts: GtinConflict[];

  if (args.allSevere) {
    const byGtin = await loadSides(args.gtins);
    const known = args.gtins ? [] : KNOWN_BAD_GTINS;
    const knownSet = new Set(known);
    const severe = detectConflicts(byGtin, {
      nameThreshold: args.nameThreshold,
      severeThreshold: args.severeThreshold,
      severeOnly: true,
      requireClassMismatch: args.requireClassMismatch,
    });
    // Always include known-bad GTINs at the normal name threshold (not only severe).
    const knownConflicts =
      known.length > 0
        ? detectConflicts(await loadSides(known), {
            nameThreshold: args.nameThreshold,
            severeThreshold: args.severeThreshold,
            severeOnly: false,
          })
        : [];
    const byListing = new Map<string, GtinConflict>();
    for (const c of [...severe, ...knownConflicts]) {
      // When scanning all, keep severe globally; for known GTINs keep any conflict.
      if (c.severe || knownSet.has(c.gtin)) byListing.set(c.listingId, c);
    }
    conflicts = [...byListing.values()];
    console.log(
      JSON.stringify({
        event: "quarantine_gtin_detect",
        mode: args.apply ? "apply" : "dry-run",
        scannedGtins: byGtin.size,
        requireClassMismatch: args.requireClassMismatch,
        conflictCount: conflicts.length,
        conflicts: conflicts.map(summarize),
      }),
    );
  } else {
    const gtins = args.gtins ?? KNOWN_BAD_GTINS;
    const byGtin = await loadSides(gtins);
    conflicts = detectConflicts(byGtin, {
      nameThreshold: args.nameThreshold,
      severeThreshold: args.severeThreshold,
      severeOnly: args.severeOnly,
      requireClassMismatch: args.requireClassMismatch,
    });
    console.log(
      JSON.stringify({
        event: "quarantine_gtin_detect",
        mode: args.apply ? "apply" : "dry-run",
        scannedGtins: byGtin.size,
        targetGtins: gtins,
        conflictCount: conflicts.length,
        conflicts: conflicts.map(summarize),
      }),
    );
  }

  if (!args.apply) {
    await closePool();
    return;
  }

  let applied = 0;
  const results: Array<{ listingId: string; newProductId: string; gtin: string; sourceKey: string }> =
    [];
  for (const c of conflicts) {
    const { newProductId } = await quarantineListing(c);
    applied++;
    results.push({
      listingId: c.listingId,
      newProductId,
      gtin: c.gtin,
      sourceKey: sourceKeyForListing(c.chainId, c.itemCode),
    });
  }

  console.log(JSON.stringify({ event: "quarantine_gtin_apply", applied, results }));
  await closePool();
}

function summarize(c: GtinConflict) {
  return {
    gtin: c.gtin,
    chainId: c.chainId,
    itemCode: c.itemCode,
    listingName: c.listingName,
    productName: c.productName,
    sim: Math.round(c.nameSimilarity * 1000) / 1000,
    reason: c.reason,
    severe: c.severe,
    listingId: c.listingId,
    productId: c.productId,
  };
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await closePool();
  process.exit(1);
});
