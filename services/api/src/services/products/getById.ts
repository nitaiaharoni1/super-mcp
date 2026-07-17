import { query } from "@super-mcp/db";
import type { ListingRow, ProductDetail, ProductRow } from "./types.js";
import { mapProduct } from "./mapProduct.js";

/** Fetches a canonical product by UUID, including per-chain listings. */
export async function getProductById(id: string): Promise<ProductDetail | null> {
  const productRes = await query<ProductRow>(
    `SELECT id, gtin, name, brand, category_l1, category_l2, size_qty, size_unit FROM product WHERE id = $1`,
    [id],
  );
  const row = productRes.rows[0];
  if (!row) return null;

  const listingsRes = await query<ListingRow>(
    `SELECT l.id, l.chain_id, c.name_he AS chain_name, l.item_code, l.name, l.brand,
            l.qty, l.unit, l.canonical_qty, l.canonical_unit, l.measure_unparseable
     FROM listing l
     JOIN chain c ON c.id = l.chain_id
     WHERE l.product_id = $1
     ORDER BY c.name_he ASC`,
    [id],
  );

  return {
    ...mapProduct(row),
    listings: listingsRes.rows.map((l) => ({
      id: l.id,
      chainId: l.chain_id,
      chainName: l.chain_name,
      itemCode: l.item_code,
      name: l.name,
      brand: l.brand,
      qty: l.qty,
      unit: l.unit,
      canonicalQty: l.canonical_qty,
      canonicalUnit: l.canonical_unit,
      measureUnparseable: l.measure_unparseable,
    })),
  };
}
