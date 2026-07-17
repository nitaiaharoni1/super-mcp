import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";

export interface ResolveProductInput {
  gtin: string | null;
  /** Chain-scoped identity for non-GTIN items ("<chain_id>:<item_code>"), used only when gtin is null. */
  sourceKey?: string;
  name: string;
  brand?: string;
  sizeQty?: number;
  sizeUnit?: string;
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

  if (input.gtin) {
    const res = await q.query<{ id: string }>(
      `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit)
       VALUES ($1, NULL, $2, $3, $4, $5)
       ON CONFLICT (gtin) DO UPDATE SET
         name = CASE
           WHEN length(EXCLUDED.name) > length(product.name) THEN EXCLUDED.name
           ELSE product.name
         END,
         brand = COALESCE(EXCLUDED.brand, product.brand),
         size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
         size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
         updated_at = now()
       RETURNING id`,
      [input.gtin, name, brand, sizeQty, sizeUnit],
    );
    return res.rows[0]!.id;
  }

  const res = await q.query<{ id: string }>(
    `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit)
     VALUES (NULL, $1, $2, $3, $4, $5)
     ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
       name = CASE
         WHEN length(EXCLUDED.name) > length(product.name) THEN EXCLUDED.name
         ELSE product.name
       END,
       brand = COALESCE(EXCLUDED.brand, product.brand),
       size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
       size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
       updated_at = now()
     RETURNING id`,
    [input.sourceKey!, name, brand, sizeQty, sizeUnit],
  );
  return res.rows[0]!.id;
}
