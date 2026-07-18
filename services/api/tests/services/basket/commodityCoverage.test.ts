import { describe, expect, it } from "vitest";
import { filterClassPeers } from "../../../src/services/basket/commodityCoverage.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

const primary = (over: Partial<BasketCandidate>): BasketCandidate => ({
  productId: "primary",
  name: "עגבניות",
  score: 0.9,
  matchedVia: "product",
  sizeQty: null,
  sizeUnit: "kg",
  hasPrice: true,
  hasLocalPrice: true,
  productClass: "produce",
  classL1: "produce",
  classL2: "vegetable_fresh",
  classL3: "tomato",
  ...over,
});

const row = (id: string, name: string, size_unit: string | null = "kg", size_qty: number | null = null) => ({
  product_id: id,
  name,
  size_qty,
  size_unit,
});

describe("filterClassPeers", () => {
  it("keeps same-commodity per-chain twins that add only size/packaging", () => {
    const kept = filterClassPeers(
      "עגבניות",
      primary({}),
      [row("a", "עגבניות"), row("b", "עגבניות ארוז 1 קג"), row("c", "עגבניות שטופות")],
    );
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b", "c"]);
  });

  it("excludes a different variety within the same class (cherry tomato)", () => {
    const kept = filterClassPeers("עגבניות", primary({}), [row("a", "עגבניות"), row("cherry", "עגבניות שרי שטוף ארוז")]);
    expect(kept.map((r) => r.product_id)).toEqual(["a"]);
  });

  it("excludes a diet/zero variety for a generic cola line", () => {
    const cola = primary({ name: "קוקה קולה", sizeUnit: "ml", classL1: "beverage", classL2: "soda", classL3: "cola" });
    const kept = filterClassPeers(
      "קוקה קולה",
      cola,
      [row("reg", "קוקה קולה בקבוק", "ml", 1500), row("zero", "קוקה קולה זירו פחית", "ml", 330)],
    );
    expect(kept.map((r) => r.product_id)).toEqual(["reg"]);
  });

  it("excludes organic/premium tiers (not neutral)", () => {
    const kept = filterClassPeers(
      "פלפל",
      primary({ name: "פלפל אדום", classL3: "pepper_bell" }),
      [row("reg", "פלפל אדום"), row("org", "פלפל אדום אורגני")],
    );
    expect(kept.map((r) => r.product_id)).toEqual(["reg"]);
  });

  it("keeps a more specific primary's per-chain twins (פלפל אדום)", () => {
    const kept = filterClassPeers(
      "פלפל",
      primary({ name: "פלפל אדום", classL3: "pepper_bell" }),
      [row("a", "פלפל אדום"), row("b", "פלפל אדום קלוף")],
    );
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b"]);
  });

  it("requires every query token to be present", () => {
    const kept = filterClassPeers("פלפל אדום", primary({ name: "פלפל אדום", classL3: "pepper_bell" }), [
      row("a", "פלפל אדום"),
      row("green", "פלפל ירוק"),
    ]);
    expect(kept.map((r) => r.product_id)).toEqual(["a"]);
  });
});
