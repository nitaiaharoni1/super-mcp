import { normalizeMeasure } from "@super-mcp/shared";
import type { BasketItemInput } from "./types.js";

/** Purchase qty result shape from `resolvePurchaseQty` (plus optional conversion meta). */
export type PurchaseQtyAssertInput = {
  qty: number;
  mode: string;
  /** Present when rounding/conversion metadata is attached (do not invent). */
  conversion?: unknown;
};

function isMassOrVolumeUnit(unit: string): boolean {
  const measure = normalizeMeasure(1, unit);
  return !measure.unparseable && (measure.unit === "g" || measure.unit === "ml");
}

/**
 * Runtime checks that purchase qty preserves the caller's physical request.
 * Used at every resolvePurchaseQty call site (direct SKU, GTIN, query, fast policy).
 */
export function assertPurchaseQtyPreservesRequest(
  input: BasketItemInput,
  purchase: PurchaseQtyAssertInput,
): void {
  if (!(purchase.qty > 0) || !Number.isFinite(purchase.qty)) {
    throw new Error("resolvePurchaseQty produced a non-positive qty");
  }

  const hasAmount =
    input.amount != null && Number.isFinite(input.amount) && input.amount > 0;
  const unit = input.unit?.trim() ?? "";

  if (hasAmount) {
    // Amount-based requests stay amount-based (never collapse to packQty-only packs).
    if (purchase.mode !== "packs" && purchase.mode !== "weighted_kg_or_l" && purchase.mode !== "units") {
      throw new Error(`unexpected purchase mode for amount-based request: ${purchase.mode}`);
    }

    if (unit && isMassOrVolumeUnit(unit)) {
      if (purchase.mode === "weighted_kg_or_l") {
        const need = normalizeMeasure(input.amount!, unit);
        if (!need.unparseable) {
          const expectedKgOrL = need.quantity / 1000;
          if (Math.abs(purchase.qty - expectedKgOrL) > 1e-9) {
            throw new Error(
              `weighted purchase qty ${purchase.qty} does not preserve requested ${input.amount} ${unit}`,
            );
          }
        }
      } else if (purchase.mode === "packs") {
        // Pack conversion from kg/L is allowed only as whole packs (ceil), never
        // a silent fractional pack that under-delivers the physical amount.
        if (!Number.isInteger(purchase.qty)) {
          throw new Error(
            "amount→packs conversion must yield an integer pack count (no fractional packs)",
          );
        }
      }
    }
  }

  if (input.packQty != null && input.amount == null) {
    // pack_qty remains an integer pack count unless a weighted listing policy applies.
    if (purchase.mode === "packs" && !Number.isInteger(purchase.qty)) {
      throw new Error("pack_qty purchase must remain an integer pack count");
    }
  }

  // When conversion/rounding metadata exists on the purchase result, require it
  // for non-integer pack conversions. Do not invent a persistence layer if absent.
  if (
    purchase.mode === "packs" &&
    !Number.isInteger(purchase.qty) &&
    purchase.conversion == null
  ) {
    throw new Error("fractional pack purchase requires conversion metadata");
  }
}
