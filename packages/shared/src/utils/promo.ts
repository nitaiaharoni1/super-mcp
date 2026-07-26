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
 * Does this promo need a coupon the shopper must have clipped?
 *
 * The feeds carry no structured field for it, only the description: 53,911 active
 * promotions say "קופון" and 53,662 of them are NOT marked club_only, so they were
 * being applied silently as if anyone pays that price. 45k of those do reduce a
 * line (average discounted price ₪6.69), which is exactly the shape that wins a
 * cheapest-store comparison and then surprises the shopper at the till: a real
 * example is "קופון קוטג 5% ב 1 שח" pricing a ₪5.90 cottage at ₪1.
 *
 * Kept as a description test because that is the only signal available, and
 * "קופון" is unambiguous in Hebrew retail copy.
 */
export function promoRequiresCoupon(description: string | null | undefined): boolean {
  if (!description) return false;
  return /קופון|coupon/i.test(description);
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

/**
 * How close an absolute `discountedPrice` must stay to what the promo's own rate
 * implies before it is believed.
 *
 * 0.7 leaves room for rounding and for a promo that stacks a little deeper than
 * its headline rate, while catching the gross mismatches that come from a blanket
 * promo filed against a SKU it was not written for (₪13.21 offered against a
 * ₪79.90 shelf price under a 5% rate is a 6x gap, not rounding).
 */
const ABSOLUTE_PRICE_MIN_SHARE_OF_RATE = 0.7;

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
      const rawRate = mechanic.params.discountRate;
      const rateFactor =
        typeof rawRate === "number" && Number.isFinite(rawRate) && rawRate > 0
          ? // rate > 1 means percent points; else a fraction
            rawRate > 1
            ? 1 - rawRate / 100
            : 1 - rawRate
          : null;
      // A blanket promo's absolute price belongs to ONE SKU, not to every SKU it
      // is filed against. Shufersal's "תו זהב 5% הנחה מותג שופרסל" carries
      // discountRate 5 AND discountedPrice 13.21; the 13.21 is 5% off some ₪13.90
      // item and is nonsense for a ₪79.90/kg beef. Reading the absolute price
      // first priced a kilo of mince at ₪13.21, and another store at ₪5.61 —
      // which then wins "cheapest" and sends the shopper to the wrong shop.
      //
      // When both signals are present and the absolute price implies a far deeper
      // cut than the rate does, the rate is the one that travels with the promo.
      // Sampled on production: 1.2% of promo-to-product links (29 of 2,458) carry
      // an absolute price contradicting their own rate by more than 30%.
      const absoluteContradictsRate =
        typeof dp === "number" &&
        Number.isFinite(dp) &&
        dp > 0 &&
        rateFactor != null &&
        rateFactor > 0 &&
        rateFactor < 1 &&
        dp < listPrice * rateFactor * ABSOLUTE_PRICE_MIN_SHARE_OF_RATE;
      if (
        !absoluteContradictsRate &&
        typeof dp === "number" &&
        Number.isFinite(dp) &&
        dp > 0
      ) {
        // Quantity-gated per-unit price ("buy N+, each at dp"): below the
        // threshold the shelf price applies; at/above it, dp is per unit.
        const minQty = Number(mechanic.params.minQty ?? 0);
        if (minQty >= 2 && qty < minQty) {
          return { effectiveTotal: listPrice * qty, applied: false, note: "below_min_qty" };
        }
        return { effectiveTotal: dp * qty, applied: true };
      }
      if (rateFactor != null && rateFactor > 0 && rateFactor < 1) {
        return { effectiveTotal: listPrice * qty * rateFactor, applied: true };
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
