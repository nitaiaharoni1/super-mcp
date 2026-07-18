import { describe, expect, it } from "vitest";
import { buildCommodityEquivalents, buildEquivalenceSet } from "../../../src/services/basket/equivalence.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

const cand = (over: Partial<BasketCandidate>): BasketCandidate => ({
  productId: crypto.randomUUID(),
  name: "עגבניות חממה",
  score: 0.9,
  matchedVia: "product",
  sizeQty: null,
  sizeUnit: "kg",
  hasPrice: true,
  hasLocalPrice: true,
  productClass: "produce_tomato",
  intentTier: 1,
  ...over,
});

describe("buildEquivalenceSet", () => {
  it("keeps gate-passing same-class, unit-compatible candidates", () => {
    const top = cand({});
    const set = buildEquivalenceSet(
      top,
      [
        top,
        cand({ name: 'עגבניה תמ"י' }),
        cand({ name: "רסק עגבניות", productClass: "canned_tomato" }), // class mismatch: out
        cand({ name: "עגבניות שרי 250 גרם", sizeQty: 0.25, sizeUnit: "kg", intentTier: 3 }), // gate fail: out
      ],
      { packTolerance: 0.5, maxEquivalents: 5 },
    );
    expect(set.map((c) => c.name)).toEqual(["עגבניות חממה", 'עגבניה תמ"י']);
  });

  it("returns only the top pick when it has no class (unclassified lines never widen)", () => {
    const top = cand({ productClass: null });
    const set = buildEquivalenceSet(top, [top, cand({ productClass: null })], {
      packTolerance: 0.5,
      maxEquivalents: 5,
    });
    expect(set).toHaveLength(1);
  });

  it("excludes a same-class candidate whose pack size diverges beyond tolerance", () => {
    const top = cand({ sizeQty: 1, sizeUnit: "kg" });
    const set = buildEquivalenceSet(
      top,
      [
        top,
        cand({ name: "within-tolerance", sizeQty: 1.4, sizeUnit: "kg" }), // +40% <= 50%: in
        cand({ name: "beyond-tolerance", sizeQty: 2, sizeUnit: "kg" }), // +100% > 50%: out
      ],
      { packTolerance: 0.5, maxEquivalents: 5 },
    );
    expect(set.map((c) => c.name)).toEqual(["עגבניות חממה", "within-tolerance"]);
  });
});

describe("buildCommodityEquivalents", () => {
  const c = (over: Partial<BasketCandidate>): BasketCandidate => ({
    productId: crypto.randomUUID(),
    name: "עגבניות",
    score: 0.9,
    matchedVia: "product",
    sizeQty: 1000,
    sizeUnit: "g",
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "produce",
    intentTier: null, // fragmented produce SKUs are tier-null yet fungible
    ...over,
  });

  it("groups fragmented per-chain produce SKUs even when intentTier is null", () => {
    const top = c({});
    const set = buildCommodityEquivalents(top, [top, c({}), c({})], "עגבניות", 5);
    expect(set).toHaveLength(3);
  });

  it("groups every red wine for a generic query so the cheapest can win", () => {
    const wine = (name: string) =>
      c({ name, productClass: "beverage", sizeUnit: "ml", sizeQty: 750 });
    const top = wine("יין אדום אמרונה קורט");
    const set = buildCommodityEquivalents(
      top,
      [top, wine("יין אדום מרלו"), wine("יין אדום קברנה סוביניון")],
      "יין אדום",
      5,
    );
    expect(set).toHaveLength(3); // all red wines are interchangeable when unspecified
  });

  it("respects query specificity: 'יין אדום קברנה' excludes non-cabernet wines", () => {
    const wine = (name: string) =>
      c({ name, productClass: "beverage", sizeUnit: "ml", sizeQty: 750 });
    const top = wine("יין אדום קברנה סוביניון גדׂו");
    const set = buildCommodityEquivalents(
      top,
      [top, wine("יין אדום קברנה רקנאטי"), wine("יין אדום מרלו")],
      "יין אדום קברנה",
      5,
    );
    expect(set.map((x) => x.name)).not.toContain("יין אדום מרלו");
    expect(set).toHaveLength(2);
  });

  it("excludes a bulk size beyond pack tolerance (2L wine vs 750ml)", () => {
    const wine = (name: string, sizeQty: number) =>
      c({ name, productClass: "beverage", sizeUnit: "ml", sizeQty });
    const top = wine("יין אדום קורט", 750);
    const set = buildCommodityEquivalents(top, [top, wine("יין אדום ביתי", 2000)], "יין אדום", 5);
    expect(set).toHaveLength(1);
  });

  it("excludes a different unit and a different class", () => {
    const top = c({});
    const set = buildCommodityEquivalents(
      top,
      [top, c({ sizeUnit: "unit" }), c({ productClass: "canned" })],
      "עגבניות",
      5,
    );
    expect(set).toHaveLength(1);
  });

  it("returns only the top pick when it has no product class", () => {
    const top = c({ productClass: null });
    expect(buildCommodityEquivalents(top, [top, c({ productClass: null })], "עגבניות", 5)).toEqual([
      top,
    ]);
  });
});
