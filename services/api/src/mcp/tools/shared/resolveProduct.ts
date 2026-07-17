import { searchProducts } from "../../../services/search/index.js";

export async function resolveProductId(
  productId: string | undefined,
  gtin: string | undefined,
): Promise<string | null> {
  if (productId) return productId;
  if (gtin) {
    const rows = await searchProducts({ q: "", gtin, limit: 1 });
    return rows[0]?.id ?? null;
  }
  return null;
}
