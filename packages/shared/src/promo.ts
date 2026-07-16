import type { PromoMechanicType, RawPromoRecord } from "./types.js";

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
    if (fields.discountedPrice != null || /מחיר מועדון|club/i.test(desc)) {
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

  if (fields.minQty != null && fields.minQty >= 2 && fields.discountedPrice != null) {
    return {
      type: "n_for_price",
      params: {
        n: fields.minQty,
        price: fields.discountedPrice,
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
    const pct = desc.match(/(\d+)\s*%/);
    return {
      type: "second_unit_pct",
      params: {
        percent: pct ? Number(pct[1]) : /בחינם|free/i.test(desc) ? 100 : 50,
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

  if (fields.discountedPrice != null) {
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
      if (typeof dp === "number") {
        return { effectiveTotal: dp * qty, applied: true };
      }
      const rate = mechanic.params.discountRate;
      if (typeof rate === "number") {
        // Heuristic: rate > 1 means percent points; else fraction
        const factor = rate > 1 ? 1 - rate / 100 : 1 - rate;
        return { effectiveTotal: listPrice * qty * Math.max(0, factor), applied: true };
      }
      return { effectiveTotal: listPrice * qty, applied: false };
    }
    case "n_for_price": {
      const n = Number(mechanic.params.n ?? mechanic.params.minQty ?? 0);
      const packPrice = Number(mechanic.params.price ?? NaN);
      if (n > 0 && Number.isFinite(packPrice)) {
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
      if (typeof dp === "number") {
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
