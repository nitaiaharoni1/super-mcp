import { describe, expect, it } from "vitest";
import { resolvePurchaseQty } from "@super-mcp/shared";

/**
 * Basket qty conversion is in shared; these cases mirror the BBQ shopping-list path.
 */
describe("basket purchase qty (shared helper)", () => {
  it("turns 1.5kg hummus into 2×750g packs", () => {
    expect(
      resolvePurchaseQty({
        amount: 1.5,
        unit: "kg",
        productSizeQty: 750,
        productSizeUnit: "g",
      }),
    ).toMatchObject({ qty: 2, mode: "packs" });
  });

  it("keeps meat as weighted kilograms", () => {
    const r = resolvePurchaseQty({ amount: 1.75, unit: "קג" });
    expect(r.qty).toBeCloseTo(1.75);
    expect(r.mode).toBe("weighted_kg_or_l");
  });

  it("turns 20 pitas into 2×10 packs", () => {
    expect(
      resolvePurchaseQty({
        amount: 20,
        unit: "יח",
        productSizeQty: 10,
        productSizeUnit: "unit",
      }),
    ).toMatchObject({ qty: 2, mode: "packs" });
  });
});
