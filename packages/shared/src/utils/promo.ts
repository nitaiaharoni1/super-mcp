import type { PromoMechanicType, RawPromoRecord } from "../types/types.js";

export interface PromoFields {
  description: string;
  minQty?: number;
  maxQty?: number;
  discountRate?: number;
  discountType?: number | string;
  minPurchaseAmount?: number;
  rewardType?: number | string;
  discountedPrice?: number;
  clubId?: string | number | null;
  raw?: Record<string, unknown>;
}

/**
 * Normalize Israeli feed promo fields into typed mechanics.
 * Prefer structured fields; fall back to Hebrew/English description heuristics.
 */
export function normalizePromoMechanic(fields: PromoFields): RawPromoRecord["mechanic"] {
  const desc = fields.description?.trim() ?? "";
  const params: Record<string, number | string | boolean | null> = {};

  const clubOnly =
    fields.clubId != null && String(fields.clubId) !== "0" && String(fields.clubId) !== "";

  // Club price
  if (clubOnly || /מועדון|club/i.test(desc)) {
    if (
      (fields.discountedPrice != null && fields.discountedPrice > 0) ||
      /מחיר מועדון|club/i.test(desc)
    ) {
      return {
        type: "club_price",
        params: {
          ...params,
          clubId: fields.clubId ?? null,
          price: fields.discountedPrice ?? null,
        },
        rawText: desc,
      };
    }
  }

  // N for price: "2 ב-30" / "3 ב 20" / "2 for 30"
  const nFor = desc.match(/(\d+)\s*(?:ב[-–]?\s*|for\s+)(\d+(?:\.\d+)?)/i);
  if (nFor) {
    return {
      type: "n_for_price",
      params: {
        n: Number(nFor[1]),
        price: Number(nFor[2]),
        minQty: fields.minQty ?? Number(nFor[1]),
      },
      rawText: desc,
    };
  }

  // Structured quantity-gated price: Israeli feeds encode "buy MinQty+, each at
  // DiscountedPrice" where DiscountedPrice is the PER-UNIT price (often equal to
  // the shelf price when the real reward is elsewhere), NOT a pack total. Genuine
  // "N for total" bundles arrive via the description branch above, which returns
  // first. Treating this as n_for_price understated cost by ~minQty× (a 3-for
  // deal priced the whole triple at one unit's price). Model it as a per-unit
  // discount gated on minQty instead.
  if (
    fields.minQty != null &&
    fields.minQty >= 2 &&
    fields.discountedPrice != null &&
    fields.discountedPrice > 0
  ) {
    return {
      type: "simple_discount",
      params: {
        discountedPrice: fields.discountedPrice,
        minQty: fields.minQty,
      },
      rawText: desc,
    };
  }

  // Second unit percent: "השני ב-50%" / "1+1" / "השני בחינם"
  if (
    /1\s*\+\s*1/i.test(desc) ||
    /השני(?:יה)?\s*בחינם/.test(desc) ||
    /השני(?:יה)?\s*ב-?\s*\d+\s*%/.test(desc) ||
    /second\s*(?:unit\s*)?\d+\s*%/i.test(desc)
  ) {
    const isBogo = /1\s*\+\s*1/i.test(desc) || /בחינם|free/i.test(desc);
    // Read the percent from the second-unit phrase itself, not a bare "\d+%"
    // scan: an unrelated percentage in the text (e.g. "3% שומן" fat content)
    // would otherwise hijack the discount, and a 1+1 deal is always 100% off
    // the second unit regardless of any percentage mentioned in the name.
    const secondUnitPct =
      desc.match(/השני(?:יה)?\s*ב-?\s*(\d+)\s*%/) ??
      desc.match(/second\s*(?:unit\s*)?(\d+)\s*%/i);
    return {
      type: "second_unit_pct",
      params: {
        percent: isBogo ? 100 : secondUnitPct ? Number(secondUnitPct[1]) : 50,
      },
      rawText: desc,
    };
  }

  // Spend threshold
  if (
    (fields.minPurchaseAmount != null && fields.minPurchaseAmount > 0) ||
    /בקנייה מ|spend|מעל\s*\d+/i.test(desc)
  ) {
    return {
      type: "spend_threshold",
      params: {
        minPurchaseAmount: fields.minPurchaseAmount ?? null,
        discountRate: fields.discountRate ?? null,
      },
      rawText: desc,
    };
  }

  // Simple discount / percent
  if (fields.discountRate != null && fields.discountRate > 0) {
    return {
      type: "simple_discount",
      params: {
        discountRate: fields.discountRate,
        discountType: fields.discountType ?? null,
        discountedPrice: fields.discountedPrice ?? null,
      },
      rawText: desc,
    };
  }

  if (fields.discountedPrice != null && fields.discountedPrice > 0) {
    return {
      type: "simple_discount",
      params: {
        discountedPrice: fields.discountedPrice,
      },
      rawText: desc,
    };
  }

  const type: PromoMechanicType = "other";
  return {
    type,
    params: {
      minQty: fields.minQty ?? null,
      maxQty: fields.maxQty ?? null,
      discountRate: fields.discountRate ?? null,
      minPurchaseAmount: fields.minPurchaseAmount ?? null,
      rewardType: fields.rewardType ?? null,
      clubOnly: clubOnly || null,
    },
    rawText: desc,
  };
}

/** Apply a promo to a single unit price for basket math (best-effort). */
export function applyPromoToUnitPrice(
  listPrice: number,
  qty: number,
  mechanic: RawPromoRecord["mechanic"],
): { effectiveTotal: number; applied: boolean; note?: string } {
  const m = mechanic.type;
  switch (m) {
    case "simple_discount": {
      const dp = mechanic.params.discountedPrice;
      if (typeof dp === "number" && Number.isFinite(dp) && dp > 0) {
        // Quantity-gated per-unit price ("buy N+, each at dp"): below the
        // threshold the shelf price applies; at/above it, dp is per unit.
        const minQty = Number(mechanic.params.minQty ?? 0);
        if (minQty >= 2 && qty < minQty) {
          return { effectiveTotal: listPrice * qty, applied: false, note: "below_min_qty" };
        }
        return { effectiveTotal: dp * qty, applied: true };
      }
      const rate = mechanic.params.discountRate;
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        // Heuristic: rate > 1 means percent points; else fraction
        const factor = rate > 1 ? 1 - rate / 100 : 1 - rate;
        if (factor > 0 && factor < 1) {
          return { effectiveTotal: listPrice * qty * factor, applied: true };
        }
      }
      return { effectiveTotal: listPrice * qty, applied: false };
    }
    case "n_for_price": {
      const n = Number(mechanic.params.n ?? mechanic.params.minQty ?? 0);
      const packPrice = Number(mechanic.params.price ?? NaN);
      if (n > 0 && Number.isFinite(packPrice) && packPrice > 0) {
        const packs = Math.floor(qty / n);
        const rem = qty % n;
        return {
          effectiveTotal: packs * packPrice + rem * listPrice,
          applied: packs > 0,
        };
      }
      return { effectiveTotal: listPrice * qty, applied: false };
    }
    case "second_unit_pct": {
      const percent = Number(mechanic.params.percent ?? 50);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return { effectiveTotal: listPrice * qty, applied: false };
      }
      const pairs = Math.floor(qty / 2);
      const rem = qty % 2;
      const secondFactor = 1 - percent / 100;
      return {
        effectiveTotal: pairs * (listPrice + listPrice * secondFactor) + rem * listPrice,
        applied: pairs > 0,
      };
    }
    case "club_price": {
      const dp = mechanic.params.price;
      if (typeof dp === "number" && Number.isFinite(dp) && dp > 0) {
        return {
          effectiveTotal: dp * qty,
          applied: true,
          note: "club_member_price",
        };
      }
      return { effectiveTotal: listPrice * qty, applied: false, note: "club_price_unknown" };
    }
    case "spend_threshold":
      return {
        effectiveTotal: listPrice * qty,
        applied: false,
        note: "spend_threshold_needs_basket_context",
      };
    case "other":
      return { effectiveTotal: listPrice * qty, applied: false, note: "other_mechanic" };
    default: {
      const _exhaustive: never = m;
      return { effectiveTotal: listPrice * qty, applied: false, note: String(_exhaustive) };
    }
  }
}
