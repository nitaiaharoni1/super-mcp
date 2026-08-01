import { normalizeMeasure, reconcileMeasureFamilyWithName } from "@super-mcp/shared";
import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";
import { query } from "./query.js";

export interface ResolveProductInput {
  gtin: string | null;
  /** Chain-scoped identity for non-GTIN items ("<chain_id>:<item_code>"), used only when gtin is null. */
  sourceKey?: string;
  name: string;
  brand?: string;
  sizeQty?: number;
  sizeUnit?: string;
  pieceCount?: number | null;
  packMetadataSource?: string | null;
}

/**
 * GTIN-first identity: same GTIN => one product row, shared across chains/stores.
 * Non-GTIN items get one chain-scoped product keyed by sourceKey
 * ("<chain_id>:<item_code>"), never merged across chains.
 *
 * Uses INSERT … ON CONFLICT (atomic upsert) so parallel ingest jobs cannot
 * create duplicate product rows for the same identity key.
 */
export async function resolveProduct(
  input: ResolveProductInput,
  client?: PoolClient,
): Promise<string | null> {
  const q = client ?? getPool();
  if (!input.gtin && !input.sourceKey) return null;

  const name = input.name;
  const brand = input.brand ?? null;
  const sizeQty = input.sizeQty ?? null;
  const sizeUnit = input.sizeUnit ?? null;
  const pieceCount = input.pieceCount ?? null;
  const packMetadataSource = input.packMetadataSource ?? null;

  if (input.gtin) {
    const res = await q.query<{ id: string }>(
      `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit,
                            piece_count, pack_metadata_source)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (gtin) DO UPDATE SET
         name = CASE
           WHEN length(EXCLUDED.name) > length(product.name) THEN EXCLUDED.name
           ELSE product.name
         END,
         brand = COALESCE(EXCLUDED.brand, product.brand),
         size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
         size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
         piece_count = COALESCE(EXCLUDED.piece_count, product.piece_count),
         pack_metadata_source = COALESCE(EXCLUDED.pack_metadata_source, product.pack_metadata_source),
         updated_at = now()
       RETURNING id`,
      [input.gtin, name, brand, sizeQty, sizeUnit, pieceCount, packMetadataSource],
    );
    return res.rows[0]!.id;
  }

  const res = await q.query<{ id: string }>(
    `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit,
                          piece_count, pack_metadata_source)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
       name = CASE
         WHEN length(EXCLUDED.name) > length(product.name) THEN EXCLUDED.name
         ELSE product.name
       END,
       brand = COALESCE(EXCLUDED.brand, product.brand),
       size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
       size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
       piece_count = COALESCE(EXCLUDED.piece_count, product.piece_count),
       pack_metadata_source = COALESCE(EXCLUDED.pack_metadata_source, product.pack_metadata_source),
       updated_at = now()
     RETURNING id`,
    [input.sourceKey!, name, brand, sizeQty, sizeUnit, pieceCount, packMetadataSource],
  );
  return res.rows[0]!.id;
}

export interface SizeUnitHealResult {
  scanned: number;
  healed: number;
}

/**
 * Self-heal product rows whose stored g/ml size_unit conflicts with the product
 * NAME at the same canonical quantity — a bottle named "1.5 ליטר" ingested as
 * 1500 g. The name is ground truth for the unit FAMILY (reconcileMeasureFamily-
 * WithName); quantity is preserved so unit-price math stays valid.
 *
 * Idempotent: only rows whose family actually flips are rewritten, so re-running
 * is a no-op. Ingestion already reconciles at write time via normalize.ts; this
 * sweep additionally repairs stragglers not present in the current feed slice
 * and any legacy rows written before the reconcile guard existed.
 */
export async function healSizeUnitFamily(): Promise<SizeUnitHealResult> {
  const res = await query<{ id: string; name: string; size_qty: string; size_unit: string }>(
    `SELECT id, name, size_qty, size_unit
       FROM product
      WHERE size_qty IS NOT NULL AND size_qty > 0
        AND size_unit IN ('g', 'kg', 'ml', 'l')`,
  );

  const ids: string[] = [];
  const qtys: number[] = [];
  const units: string[] = [];
  for (const row of res.rows) {
    const db = normalizeMeasure(Number(row.size_qty), row.size_unit);
    if (db.unparseable) continue;
    const reconciled = reconcileMeasureFamilyWithName(row.name, db);
    if (reconciled.unit !== db.unit) {
      ids.push(row.id);
      qtys.push(reconciled.quantity);
      units.push(reconciled.unit);
    }
  }

  if (ids.length > 0) {
    // Canonical quantity may differ from the stored one (kg→g scaling), so write
    // both fields from the reconciled measure.
    await query(
      `UPDATE product p
          SET size_qty = v.qty::numeric, size_unit = v.unit, updated_at = now()
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::numeric[]) AS qty,
                      unnest($3::text[]) AS unit) v
        WHERE p.id = v.id`,
      [ids, qtys, units],
    );
  }

  return { scanned: res.rows.length, healed: ids.length };
}

export interface StoreCountRefreshResult {
  /** Products whose stored count changed (0 on a no-op re-run). */
  updated: number;
}

/**
 * Recompute `product.store_count`, the number of stores currently pricing each
 * product.
 *
 * Search breaks score ties on this. A leading whole-word name match scores a
 * flat 0.95, so a one-word staple query ties hundreds of products, and the old
 * `p.name ASC` tiebreak turned the 20-wide candidate pool into an alphabet
 * lottery: "שמן" retrieved watermelon, oregano and argan oil while canola in
 * 747 stores was never a candidate at all.
 *
 * Full recompute rather than incremental: the whole aggregate runs in under a
 * second over 122k products, and a stale popularity signal degrades every
 * search quietly, which is exactly the kind of failure worth spending a second
 * to rule out. Idempotent, and never fatal to an ingest.
 */
export async function refreshProductStoreCounts(): Promise<StoreCountRefreshResult> {
  // Both counts in one pass: they scan the same join, and computing them apart
  // lets them disagree, which is worse than either being briefly stale.
  //
  // branch_store_count counts ONLY shoppable branches. It is what the physical
  // surface filters on, because a product sold solely online cannot be bought by
  // walking in — and letting such products win candidate slots cost that surface
  // roughly 9 seconds a basket the first time an online ingest ran.
  const res = await query(
    `UPDATE product p
        SET store_count = COALESCE(c.n, 0),
            branch_store_count = COALESCE(c.branch_n, 0)
       FROM (
         SELECT l.product_id,
                count(DISTINCT sp.store_id) AS n,
                count(DISTINCT sp.store_id) FILTER (WHERE s.store_kind = 'branch') AS branch_n
           FROM listing l
           JOIN store_price sp ON sp.listing_id = l.id
           JOIN store s ON s.id = sp.store_id
          GROUP BY l.product_id
       ) c
      WHERE c.product_id = p.id
        AND (p.store_count IS DISTINCT FROM c.n
             OR p.branch_store_count IS DISTINCT FROM c.branch_n)`,
  );
  return { updated: res.rowCount ?? 0 };
}
