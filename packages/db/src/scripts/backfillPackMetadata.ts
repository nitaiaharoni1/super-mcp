import { cityMatchKeys, inferPackSizeFromName, normalizeMeasure } from "@super-mcp/shared";
import { closePool, getPool } from "../client/index.js";

/**
 * Backfill listing/product pack-sale facts from existing names and size stubs.
 *
 * Heuristics (conservative — prefer leaving NULL over inventing facts):
 *   piece_count / sale_basis:
 *     - Derive only via inferPackSizeFromName when it yields a unit pack.
 *     - sale_basis = per_pack when piece_count > 1, else per_piece.
 *     - measure_source = name_inferred, confidence = 0.7.
 *   is_weighted:
 *     - Only when listing.is_weighted IS NULL.
 *     - Set true when canonical_unit ∈ (g, ml) AND canonical_qty ≈ 1000 (±5%)
 *       AND the name has no מארז/N יח pack cue — the historical weighted-
 *       produce stub from normalizeMeasure (missing weighted qty → 1000g).
 *       Packaged goods with real sizes (e.g. 500g yogurt) are left alone.
 *     - Never clear an existing is_weighted; never invent sale_basis for
 *       weighted rows beyond per_kg/per_l from the canonical unit.
 *
 * Flags:
 *   --dry-run            skip writes, print what would change
 *   --city=<name>        scope to listings priced at stores in that city
 *                        (store → store_price → listing)
 *   --limit=N            cap distinct listings scanned
 */

interface Args {
  dryRun: boolean;
  city: string | null;
  limit: number | null;
}

interface ListingRow {
  id: string;
  product_id: string | null;
  name: string;
  canonical_qty: number | null;
  canonical_unit: string | null;
  is_weighted: boolean | null;
  sale_basis: string | null;
  piece_count: number | null;
  measure_source: string | null;
  measure_confidence: number | null;
}

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let city: string | null = null;
  let limit: number | null = null;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--city=")) {
      city = arg.slice("--city=".length).trim();
      if (!city) throw new Error("invalid --city");
    } else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(limit) || limit <= 0) throw new Error("invalid --limit");
    }
  }
  return { dryRun, city, limit };
}

const NAME_UNIT_PACK_RE = /מארז|\d+(?:\.\d+)?\s*(?:יחידות|יח['׳]?|units?|pcs)/i;

function qtyAround1000(qty: number | null): boolean {
  if (qty == null || !Number.isFinite(qty)) return false;
  return Math.abs(qty - 1000) / 1000 <= 0.05;
}

function inferUnitPieceCount(name: string): number | null {
  const inferred = inferPackSizeFromName(name);
  if (!inferred) return null;
  const m = normalizeMeasure(inferred.quantity, inferred.unit);
  if (m.unparseable || m.unit !== "unit" || m.quantity <= 0) return null;
  return m.quantity;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();

  const params: unknown[] = [];
  let cityJoin = "";
  let cityWhere = "";
  if (args.city) {
    const keys = cityMatchKeys(args.city);
    if (keys.length === 0) throw new Error(`--city=${args.city} produced no match keys`);
    params.push(keys);
    cityJoin = `
      JOIN store_price sp ON sp.listing_id = l.id
      JOIN store s ON s.id = sp.store_id`;
    cityWhere = ` AND s.city = ANY($${params.length}::text[])`;
  }

  const limitSql = args.limit ? `LIMIT ${Math.floor(args.limit)}` : "";

  const res = await pool.query<ListingRow & { class_l1: string | null }>(
    `SELECT DISTINCT ON (l.id)
       l.id, l.product_id, l.name, l.canonical_qty, l.canonical_unit,
       l.is_weighted, l.sale_basis, l.piece_count, l.measure_source, l.measure_confidence,
       m.class_l1
     FROM listing l
     LEFT JOIN product p ON p.id = l.product_id
     LEFT JOIN product_class_map m ON m.product_id = p.id AND m.input_name = p.name
     ${cityJoin}
     WHERE 1=1${cityWhere}
     ORDER BY l.id
     ${limitSql}`,
    params,
  );

  let scanned = 0;
  let pieceCountSet = 0;
  let weightedSet = 0;
  let saleBasisSet = 0;
  let productsUpdated = 0;
  let skipped = 0;

  for (const row of res.rows) {
    scanned++;
    const updates: {
      piece_count?: number;
      sale_basis?: string;
      is_weighted?: boolean;
      measure_source?: string;
      measure_confidence?: number;
    } = {};

    // --- piece_count / sale_basis from name ---
    if (row.piece_count == null) {
      const pieces = inferUnitPieceCount(row.name);
      if (pieces != null) {
        updates.piece_count = pieces;
        updates.sale_basis =
          row.sale_basis ?? (pieces > 1 ? "per_pack" : "per_piece");
        updates.measure_source = "name_inferred";
        updates.measure_confidence = 0.7;
      }
    } else if (row.sale_basis == null && row.piece_count > 0) {
      updates.sale_basis = row.piece_count > 1 ? "per_pack" : "per_piece";
      updates.measure_source = row.measure_source ?? "name_inferred";
      updates.measure_confidence = row.measure_confidence ?? 0.7;
    }

    // --- conservative is_weighted: produce-class 1000g/ml stubs only ---
    // Never mark packaged pantry/dairy 1kg bags as weighted from qty≈1000 alone.
    const classL1 = (row as ListingRow & { class_l1: string | null }).class_l1;
    if (
      row.is_weighted == null &&
      classL1 === "produce" &&
      (row.canonical_unit === "g" || row.canonical_unit === "ml") &&
      qtyAround1000(row.canonical_qty) &&
      !NAME_UNIT_PACK_RE.test(row.name) &&
      inferUnitPieceCount(row.name) == null
    ) {
      updates.is_weighted = true;
      if (row.sale_basis == null && updates.sale_basis == null) {
        updates.sale_basis = row.canonical_unit === "ml" ? "per_l" : "per_kg";
      }
      if (updates.measure_source == null) {
        updates.measure_source = "weighted_default";
        updates.measure_confidence = 0.5;
      }
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    if (updates.piece_count != null) pieceCountSet++;
    if (updates.is_weighted === true) weightedSet++;
    if (updates.sale_basis != null) saleBasisSet++;

    if (!args.dryRun) {
      await pool.query(
        `UPDATE listing SET
           piece_count = COALESCE($2, piece_count),
           sale_basis = COALESCE($3, sale_basis),
           is_weighted = COALESCE($4, is_weighted),
           measure_source = COALESCE($5, measure_source),
           measure_confidence = COALESCE($6, measure_confidence),
           updated_at = now()
         WHERE id = $1`,
        [
          row.id,
          updates.piece_count ?? null,
          updates.sale_basis ?? null,
          updates.is_weighted ?? null,
          updates.measure_source ?? null,
          updates.measure_confidence ?? null,
        ],
      );

      // Optional product rollup when we inferred a piece count.
      if (row.product_id && updates.piece_count != null) {
        const prod = await pool.query(
          `UPDATE product SET
             piece_count = COALESCE(piece_count, $2),
             pack_metadata_source = COALESCE(pack_metadata_source, 'name_inferred'),
             updated_at = now()
           WHERE id = $1 AND piece_count IS NULL
           RETURNING id`,
          [row.product_id, updates.piece_count],
        );
        if ((prod.rowCount ?? 0) > 0) productsUpdated++;
      }
    } else if (row.product_id && updates.piece_count != null) {
      productsUpdated++;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        city: args.city,
        limit: args.limit,
        scanned,
        pieceCountSet,
        weightedSet,
        saleBasisSet,
        productsUpdated,
        skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
