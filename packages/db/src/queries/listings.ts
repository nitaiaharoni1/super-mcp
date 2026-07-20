import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";

export interface UpsertListingInput {
  productId: string | null;
  chainId: string;
  itemCode: string;
  itemType: number;
  isGtin: boolean;
  name: string;
  brand?: string;
  qty?: number;
  unit?: string;
  canonicalQty?: number;
  canonicalUnit?: string;
  measureUnparseable: boolean;
  isWeighted?: boolean | null;
  saleBasis?: string | null;
  pieceCount?: number | null;
  measureSource?: string | null;
  measureConfidence?: number | null;
}

export async function upsertListing(input: UpsertListingInput, client?: PoolClient): Promise<string> {
  const q = client ?? getPool();
  const res = await q.query<{ id: string }>(
    `INSERT INTO listing (
       product_id, chain_id, item_code, item_type, is_gtin, name, brand,
       qty, unit, canonical_qty, canonical_unit, measure_unparseable,
       is_weighted, sale_basis, piece_count, measure_source, measure_confidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (chain_id, item_code) DO UPDATE SET
       product_id = COALESCE(EXCLUDED.product_id, listing.product_id),
       item_type = EXCLUDED.item_type,
       is_gtin = EXCLUDED.is_gtin,
       name = EXCLUDED.name,
       brand = COALESCE(EXCLUDED.brand, listing.brand),
       qty = COALESCE(EXCLUDED.qty, listing.qty),
       unit = COALESCE(EXCLUDED.unit, listing.unit),
       canonical_qty = COALESCE(EXCLUDED.canonical_qty, listing.canonical_qty),
       canonical_unit = COALESCE(EXCLUDED.canonical_unit, listing.canonical_unit),
       measure_unparseable = EXCLUDED.measure_unparseable,
       is_weighted = COALESCE(EXCLUDED.is_weighted, listing.is_weighted),
       sale_basis = CASE
         WHEN EXCLUDED.sale_basis IS NOT NULL
          AND (listing.sale_basis IS NULL
               OR COALESCE(EXCLUDED.measure_confidence, 0)
                    >= COALESCE(listing.measure_confidence, 0))
         THEN EXCLUDED.sale_basis
         ELSE COALESCE(listing.sale_basis, EXCLUDED.sale_basis)
       END,
       piece_count = CASE
         WHEN EXCLUDED.piece_count IS NOT NULL
          AND (listing.piece_count IS NULL
               OR COALESCE(EXCLUDED.measure_confidence, 0)
                    >= COALESCE(listing.measure_confidence, 0))
         THEN EXCLUDED.piece_count
         ELSE COALESCE(listing.piece_count, EXCLUDED.piece_count)
       END,
       measure_source = CASE
         WHEN EXCLUDED.measure_source IS NOT NULL
          AND (listing.measure_source IS NULL
               OR COALESCE(EXCLUDED.measure_confidence, 0)
                    >= COALESCE(listing.measure_confidence, 0))
         THEN EXCLUDED.measure_source
         ELSE COALESCE(listing.measure_source, EXCLUDED.measure_source)
       END,
       measure_confidence = CASE
         WHEN EXCLUDED.measure_confidence IS NOT NULL
          AND (listing.measure_confidence IS NULL
               OR EXCLUDED.measure_confidence >= listing.measure_confidence)
         THEN EXCLUDED.measure_confidence
         ELSE listing.measure_confidence
       END,
       updated_at = now()
     RETURNING id`,
    [
      input.productId,
      input.chainId,
      input.itemCode,
      input.itemType,
      input.isGtin,
      input.name,
      input.brand ?? null,
      input.qty ?? null,
      input.unit ?? null,
      input.canonicalQty ?? null,
      input.canonicalUnit ?? null,
      input.measureUnparseable,
      input.isWeighted ?? null,
      input.saleBasis ?? null,
      input.pieceCount ?? null,
      input.measureSource ?? null,
      input.measureConfidence ?? null,
    ],
  );
  return res.rows[0]!.id;
}

/**
 * Deletes a stale listing left behind when the same physical item flips GTIN
 * classification across ingests (e.g. a borderline digit-length/itemType code
 * that resolves differently one run to the next). Listing identity is keyed on
 * (chain_id, item_code) where item_code = gtin ?? rawItemCode, so a flip makes
 * ON CONFLICT miss and creates a second row instead of updating the first —
 * orphaning the old one with stale price history and, once non-GTIN items got
 * a persistent product identity, a stale product_id that duplicates search/
 * basket results. Called with the *other* classification's key before every
 * upsertListing; a no-op when the two keys are identical (the common case for
 * clean feeds, since gtin == normalizeGtin(rawItemCode) already).
 */
export async function reapReclassifiedListing(
  chainId: string,
  currentItemCode: string,
  otherItemCode: string,
  client?: PoolClient,
): Promise<void> {
  if (currentItemCode === otherItemCode) return;
  // A GTIN classification flip always involves an 8+ digit key on the other
  // side (isGtinItem requires it). A short digit key here means the item was
  // never GTIN-classified — deleting would hit an unrelated internal-code
  // listing and cascade-wipe its price history.
  if (otherItemCode.replace(/\D/g, "").length < 8) return;
  const q = client ?? getPool();
  // promotion_item.listing_id references listing(id) with no ON DELETE clause (defaults to
  // RESTRICT), so clear any dangling reference first or the DELETE throws a FK violation.
  await q.query(
    `UPDATE promotion_item SET listing_id = NULL
     WHERE listing_id = (SELECT id FROM listing WHERE chain_id = $1 AND item_code = $2)`,
    [chainId, otherItemCode],
  );
  await q.query(`DELETE FROM listing WHERE chain_id = $1 AND item_code = $2`, [
    chainId,
    otherItemCode,
  ]);
}
