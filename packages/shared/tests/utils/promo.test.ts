import { describe, expect, it } from "vitest";
import { applyPromoToUnitPrice, normalizePromoMechanic } from "../../src/utils/promo.js";

describe("normalizePromoMechanic", () => {
  it("parses n-for-price from Hebrew", () => {
    const m = normalizePromoMechanic({ description: "2 ב-30 קוטג'" });
    expect(m.type).toBe("n_for_price");
    expect(m.params.n).toBe(2);
    expect(m.params.price).toBe(30);
  });

  it("parses second unit percent", () => {
    const m = normalizePromoMechanic({ description: "השני ב-50%" });
    expect(m.type).toBe("second_unit_pct");
    expect(m.params.percent).toBe(50);
  });

  it("treats 1+1 as second unit free (100%), not 50%", () => {
    const m = normalizePromoMechanic({ description: "1+1 קולה" });
    expect(m.type).toBe("second_unit_pct");
    expect(m.params.percent).toBe(100);
  });

  it("treats השני בחינם as second unit free", () => {
    const m = normalizePromoMechanic({ description: "השני בחינם" });
    expect(m.type).toBe("second_unit_pct");
    expect(m.params.percent).toBe(100);
  });

  it("keeps 1+1 at 100% even when the description mentions a percentage (fat content)", () => {
    const m = normalizePromoMechanic({ description: "1+1 חלב 3% שומן" });
    expect(m.type).toBe("second_unit_pct");
    expect(m.params.percent).toBe(100);
  });

  it("reads the second-unit percent from the deal phrase, not an earlier unrelated percent", () => {
    const m = normalizePromoMechanic({ description: "חלב 3% שומן - השני ב-50%" });
    expect(m.type).toBe("second_unit_pct");
    expect(m.params.percent).toBe(50);
  });

  it("keeps unknown as other", () => {
    const m = normalizePromoMechanic({ description: "מבצע מיוחד בסניף" });
    expect(m.type).toBe("other");
  });

  it("does not treat a zero placeholder price as a free promotion", () => {
    const m = normalizePromoMechanic({
      description: "חומוס צבר 400 גרם",
      discountedPrice: 0,
    });
    expect(m.type).toBe("other");
  });
});

describe("applyPromoToUnitPrice", () => {
  it("applies 2 for 20", () => {
    const r = applyPromoToUnitPrice(12, 2, {
      type: "n_for_price",
      params: { n: 2, price: 20 },
    });
    expect(r.effectiveTotal).toBe(20);
    expect(r.applied).toBe(true);
  });

  it("rejects zero-valued simple, bundle, and club prices", () => {
    expect(
      applyPromoToUnitPrice(15, 2, {
        type: "simple_discount",
        params: { discountedPrice: 0 },
      }),
    ).toEqual({ effectiveTotal: 30, applied: false });
    expect(
      applyPromoToUnitPrice(15, 2, {
        type: "n_for_price",
        params: { n: 2, price: 0 },
      }),
    ).toEqual({ effectiveTotal: 30, applied: false });
    expect(
      applyPromoToUnitPrice(15, 2, {
        type: "club_price",
        params: { price: 0 },
      }),
    ).toMatchObject({ effectiveTotal: 30, applied: false });
  });

  it("rejects invalid second-unit percentages", () => {
    for (const percent of [-10, 0, 101, 200, Number.NaN]) {
      expect(
        applyPromoToUnitPrice(15, 2, {
          type: "second_unit_pct",
          params: { percent },
        }),
      ).toEqual({ effectiveTotal: 30, applied: false });
    }
  });
});
