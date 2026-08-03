import { describe, expect, it } from "vitest";
import { compareClassPaths, isValidClassPath } from "../../src/intent/productClassTaxonomy.js";

describe("isValidClassPath", () => {
  it("accepts a full valid path", () => {
    expect(isValidClassPath("produce", "vegetable_fresh", "onion")).toBe(true);
  });
  it("accepts l1-only and l1+l2", () => {
    expect(isValidClassPath("beverage", null, null)).toBe(true);
    expect(isValidClassPath("beverage", "soda", null)).toBe(true);
  });
  it("rejects an l2 that doesn't belong to the l1", () => {
    expect(isValidClassPath("produce", "soda", null)).toBe(false);
  });
  it("rejects an l3 that doesn't belong to the l2", () => {
    expect(isValidClassPath("produce", "vegetable_fresh", "salmon")).toBe(false);
  });
  it("rejects an unknown l1", () => {
    expect(isValidClassPath("nope", null, null)).toBe(false);
  });
});

describe("sweet spreads and syrups have leaves", () => {
  // honey_jam held honey, jam, nut butter and maple/date syrup in ONE bucket with
  // no L3, so coverage fell back to L2 breadth and a "דבש" line could be filled
  // with apricot jam or peanut butter. Maple syrup had no home at all and the
  // classifier scattered it over beverage/syrup_concentrate, pantry_dry/oil_vinegar
  // and pantry_dry/salt_sugar, so two identical maple syrups were not peers.
  it("accepts the sweet-spread leaves", () => {
    for (const l3 of ["honey", "jam_preserve", "nut_seed_butter", "date_syrup_silan", "maple_syrup"]) {
      expect(isValidClassPath("spreads_condiments", "honey_jam", l3)).toBe(true);
    }
  });

  it("keeps honey, jam and maple syrup mutually non-substitutable", () => {
    const honey = { l1: "spreads_condiments", l2: "honey_jam", l3: "honey" };
    const jam = { l1: "spreads_condiments", l2: "honey_jam", l3: "jam_preserve" };
    const maple = { l1: "spreads_condiments", l2: "honey_jam", l3: "maple_syrup" };
    expect(compareClassPaths(honey, jam)).toBe("different");
    expect(compareClassPaths(honey, maple)).toBe("different");
    expect(compareClassPaths(maple, maple)).toBe("same");
  });
});

describe("compareClassPaths", () => {
  const p = (l1: string | null, l2: string | null = null, l3: string | null = null) => ({ l1, l2, l3 });

  it("returns unknown when either side has no l1 (preserves pre-classification behavior)", () => {
    expect(compareClassPaths(p(null), p("produce", "vegetable_fresh", "onion"))).toBe("unknown");
  });
  it("different l1 -> different", () => {
    expect(compareClassPaths(p("produce", "vegetable_fresh", "pepper_bell"), p("pantry_dry", "spices_seasoning"))).toBe("different");
  });
  it("same l1, different l3 -> different (onion vs scallion)", () => {
    expect(
      compareClassPaths(p("produce", "vegetable_fresh", "onion"), p("produce", "vegetable_fresh", "scallion")),
    ).toBe("different");
  });
  it("same to the deepest shared level -> same (one lacks l3)", () => {
    expect(
      compareClassPaths(p("produce", "vegetable_fresh", "tomato"), p("produce", "vegetable_fresh", null)),
    ).toBe("same");
  });
  it("identical full path -> same", () => {
    expect(
      compareClassPaths(p("produce", "fruit_fresh", "lemon"), p("produce", "fruit_fresh", "lemon")),
    ).toBe("same");
  });
  it("lemon vs lime -> different", () => {
    expect(
      compareClassPaths(p("produce", "fruit_fresh", "lemon"), p("produce", "fruit_fresh", "lime")),
    ).toBe("different");
  });
});
