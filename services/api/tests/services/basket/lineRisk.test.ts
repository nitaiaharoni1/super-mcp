import { describe, expect, it } from "vitest";
import { classifyLineRisk } from "../../../src/services/basket/lineRisk.js";

describe("classifyLineRisk", () => {
  it("commodity: shortlist agrees on one class -> auto", () => {
    expect(
      classifyLineRisk("עגבניות", [
        { productClass: "produce_tomato", brand: null, intentTier: 1 },
        { productClass: "produce_tomato", brand: 'תמ"י', intentTier: 1 },
      ]).kind,
    ).toBe("commodity");
  });

  it("cross_class: top candidates split across classes -> confirm (קולה: drink vs candy)", () => {
    const risk = classifyLineRisk("קולה", [
      { productClass: "soft_drink", brand: "קוקה קולה", intentTier: 1 },
      { productClass: "candy", brand: null, intentTier: 1 },
    ]);
    expect(risk.kind).toBe("cross_class");
    if (risk.kind === "cross_class") {
      expect(risk.classes).toEqual(expect.arrayContaining(["soft_drink", "candy"]));
    }
  });

  it("brand_pinned: query names a brand -> only exact-brand candidates are safe", () => {
    const risk = classifyLineRisk("קפה טסטרס צויס", [
      { productClass: "instant_coffee", brand: "טסטרס צ'ויס", intentTier: 1 },
      { productClass: "instant_coffee", brand: "עלית", intentTier: 1 },
    ]);
    expect(risk.kind).toBe("brand_pinned");
    if (risk.kind === "brand_pinned") {
      expect(risk.pinnedBrand).toMatch(/טסטרס/);
    }
  });

  it("brand_pinned tolerates a curly apostrophe (U+2019) in the brand spelling", () => {
    // The shared normalizer strips the ASCII apostrophe but turns U+2019 into a
    // space, so the local geresh/gershayim/apostrophe strip must run first.
    const risk = classifyLineRisk("קפה טסטרס צויס", [
      { productClass: "instant_coffee", brand: "טסטרס צ’ויס", intentTier: 1 },
    ]);
    expect(risk.kind).toBe("brand_pinned");
    if (risk.kind === "brand_pinned") {
      expect(risk.pinnedBrand).toMatch(/טסטרס/);
    }
  });

  it("opaque: no candidate carries a product class", () => {
    expect(
      classifyLineRisk("משהו", [
        { productClass: null, brand: null, intentTier: 1 },
        { productClass: null, brand: null, intentTier: 2 },
      ]).kind,
    ).toBe("opaque");
  });

  it("falls back to the whole shortlist when no strong (tier 1-2) candidate exists", () => {
    expect(
      classifyLineRisk("עגבניות", [
        { productClass: "produce_tomato", brand: null, intentTier: 3 },
        { productClass: "produce_tomato", brand: null, intentTier: 3 },
      ]).kind,
    ).toBe("commodity");
  });
});
