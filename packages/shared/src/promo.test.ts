import { describe, expect, it } from "vitest";
import { applyPromoToUnitPrice, normalizePromoMechanic } from "./promo.js";

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

  it("keeps unknown as other", () => {
    const m = normalizePromoMechanic({ description: "מבצע מיוחד בסניף" });
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
});
