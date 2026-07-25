import { describe, expect, it } from "vitest";
import { promoRequiresCoupon } from "../../src/utils/promo.js";

/**
 * The feeds carry no structured coupon field, only the description, so this test
 * pins the real strings seen in the catalog.
 */
describe("promoRequiresCoupon", () => {
  it("detects the coupon wording the feeds actually use", () => {
    for (const d of [
      "קופון קוטג 5% ב 1 שח",
      "קופון קוטג  250גר תנובה ב1שח",
      "Coupon: 2 for 10",
      "COUPON DEAL",
    ]) {
      expect(promoRequiresCoupon(d), d).toBe(true);
    }
  });

  it("does not flag ordinary or club promos", () => {
    for (const d of [
      "מבצע",
      "מחיר מועדון",
      "2 ב 10 שח",
      "3 יחידות ב 20",
      "הנחה 20%",
      "",
      null,
      undefined,
    ]) {
      expect(promoRequiresCoupon(d as string | null | undefined), String(d)).toBe(false);
    }
  });
});
