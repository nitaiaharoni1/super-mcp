import type { BasketItemInput } from "./types.js";

/**
 * Runtime checks that purchase qty preserves the caller's physical request.
 * Used at every resolvePurchaseQty call site (direct SKU, GTIN, query, fast policy).
 */
export function assertPurchaseQtyPreservesRequest(
  input: BasketItemInput,
  purchase: { qty: number; mode: string },
): void {
  if (!(purchase.qty > 0) || !Number.isFinite(purchase.qty)) {
    throw new Error("resolvePurchaseQty produced a non-positive qty");
  }
  if (input.packQty != null && input.amount == null) {
    // pack_qty remains an integer pack count unless a weighted listing policy applies.
    if (purchase.mode === "packs" && !Number.isInteger(purchase.qty)) {
      throw new Error("pack_qty purchase must remain an integer pack count");
    }
  }
}
