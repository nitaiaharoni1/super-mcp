import { describe, expect, it } from "vitest";
import { filterClassPeers } from "../../../src/services/basket/commodityCoverage.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

const primary = (over: Partial<BasketCandidate>): BasketCandidate => ({
  productId: "primary",
  name: "מלפפונים",
  score: 0.9,
  matchedVia: "product",
  sizeQty: null,
  sizeUnit: "kg",
  hasPrice: true,
  hasLocalPrice: true,
  productClass: "produce",
  classL1: "produce",
  classL2: "vegetable_fresh",
  classL3: "cucumber",
  variant: "regular",
  ...over,
});

const row = (id: string, name: string, size_unit: string | null = "kg", size_qty: number | null = null) => ({
  product_id: id,
  name,
  size_qty,
  size_unit,
});

// filterClassPeers now only holds query SPECIFICITY (morphology-tolerant) + unit;
// class and variant are filtered in SQL (fetchCarriedClassPeers).
describe("filterClassPeers", () => {
  it("keeps per-chain twins across Hebrew plural/singular (מלפפונים↔מלפפון)", () => {
    const kept = filterClassPeers(
      "מלפפונים",
      primary({}),
      [row("a", "מלפפון"), row("b", "מלפפון ארוז"), row("c", "מלפפונים")],
    );
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b", "c"]);
  });

  it("holds query specificity: a cabernet line excludes merlot", () => {
    const wine = primary({ name: "יין אדום קברנה", sizeUnit: "ml", classL3: "red_wine" });
    const kept = filterClassPeers(
      "יין אדום קברנה",
      wine,
      [row("cab", "יין אדום קברנה סוביניון", "ml", 750), row("merlot", "יין אדום מרלו", "ml", 750)],
    );
    expect(kept.map((r) => r.product_id)).toEqual(["cab"]);
  });

  it("excludes a different unit", () => {
    const kept = filterClassPeers("מלח גס", primary({ name: "מלח גס", classL3: "salt", sizeUnit: "g" }), [
      row("a", "מלח גס 1 קג", "g", 1000),
      row("u", "מלח גס יחידה", "unit", 1),
    ]);
    expect(kept.map((r) => r.product_id)).toEqual(["a"]);
  });

  it("returns [] on an empty query", () => {
    expect(filterClassPeers("", primary({}), [row("a", "מלפפון")])).toEqual([]);
  });
});
