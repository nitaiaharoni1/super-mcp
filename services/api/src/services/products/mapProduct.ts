import type { ProductRow, ProductSummary } from "./types.js";

export function mapProduct(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    gtin: row.gtin,
    name: row.name,
    brand: row.brand,
    categoryL1: row.category_l1,
    categoryL2: row.category_l2,
    sizeQty: row.size_qty,
    sizeUnit: row.size_unit,
    pieceCount: row.piece_count,
  };
}
