/**
 * A blanket promo's absolute price belongs to one SKU, not to every SKU it names.
 *
 * Shufersal files "תו זהב 5% הנחה מותג שופרסל" against many products, carrying
 * BOTH `discountRate: 5` and `discountedPrice: 13.21`. The absolute figure is 5%
 * off some ₪13.90 item; it is meaningless for a ₪79.90/kg beef. But
 * `applyPromoToUnitPrice` reads `discountedPrice` first and returns it, never
 * looking at the rate, so a live query priced a kilo of ground beef at
 *
 *     ₪79.90/kg  ->  ₪13.21
 *
 * and another store claimed ₪5.61 for a kilo of beef. In a price-comparison tool
 * that is the worst possible error: the bogus figure wins "cheapest" and sends
 * someone to the wrong shop.
 *
 * Sampled on production: 29 of 2,458 promo-to-product links (1.2%) carry an
 * absolute price that contradicts their own rate by more than 30%.
 *
 * When both signals are present and they disagree, the RATE is the one that
 * travels with the promo; the absolute price is a leftover from whichever SKU the
 * feed wrote the row against.
 */
import { describe, expect, it } from "vitest";
import { applyPromoToUnitPrice } from "../../src/utils/promo.js";

const goldTag = (discountedPrice: number) => ({
  type: "simple_discount" as const,
  params: { discountRate: 5, discountType: "0", discountedPrice },
});

describe("a discounted price that contradicts its own rate is not trusted", () => {
  it("prices the beef off the rate, not the other SKU's absolute price", () => {
    const r = applyPromoToUnitPrice(79.9, 1, goldTag(13.21));
    // 5% off ₪79.90, not ₪13.21.
    expect(r.effectiveTotal).toBeCloseTo(75.905, 2);
    expect(r.applied).toBe(true);
  });

  it("still honours an absolute price that agrees with the rate", () => {
    // The row was written for THIS product: 5% off ₪13.90 really is ₪13.21.
    const r = applyPromoToUnitPrice(13.9, 1, goldTag(13.21));
    expect(r.effectiveTotal).toBeCloseTo(13.21, 2);
    expect(r.applied).toBe(true);
  });

  it("scales an absolute price by quantity as before", () => {
    const r = applyPromoToUnitPrice(13.9, 3, goldTag(13.21));
    expect(r.effectiveTotal).toBeCloseTo(39.63, 2);
  });

  it("leaves a promo carrying only an absolute price completely alone", () => {
    // No rate to cross-check against, so there is nothing to be suspicious of.
    const r = applyPromoToUnitPrice(79.9, 1, {
      type: "simple_discount",
      params: { discountedPrice: 13.21 },
    });
    expect(r.effectiveTotal).toBeCloseTo(13.21, 2);
  });

  it("leaves a promo carrying only a rate completely alone", () => {
    const r = applyPromoToUnitPrice(79.9, 1, {
      type: "simple_discount",
      params: { discountRate: 5 },
    });
    expect(r.effectiveTotal).toBeCloseTo(75.905, 2);
  });

  it("keeps honouring a genuinely deep absolute discount when no rate disputes it", () => {
    const r = applyPromoToUnitPrice(20, 1, {
      type: "simple_discount",
      params: { discountedPrice: 5 },
    });
    expect(r.effectiveTotal).toBeCloseTo(5, 2);
  });

  it("respects the min-qty gate on a consistent absolute price", () => {
    const r = applyPromoToUnitPrice(13.9, 1, {
      type: "simple_discount",
      params: { discountedPrice: 13.21, minQty: 2 },
    });
    expect(r.applied).toBe(false);
    expect(r.effectiveTotal).toBeCloseTo(13.9, 2);
  });
});
