import { describe, expect, it } from "vitest";
import {
  coverageQueryText,
  filterClassPeers,
  isCoverageTarget,
} from "../../../src/services/basket/commodityCoverage.js";
import type { BasketCandidate, BasketItemInput, ResolvedItem } from "../../../src/services/basket/types.js";

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

function resolvedLine(over: Partial<ResolvedItem>): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "legacy_packs",
    amount: null,
    unit: null,
    productId: "primary",
    name: "מלפפונים",
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 1,
    lowConfidence: false,
    candidates: [primary({})],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
    ...over,
  };
}

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

describe("isCoverageTarget / coverageQueryText (product_id broadening)", () => {
  it("includes confirmed product_id lines even without a free-text query", () => {
    const items: BasketItemInput[] = [{ productId: "primary", qty: 1 }];
    expect(
      isCoverageTarget(
        resolvedLine({ resolvedBy: "product_id", resolutionStatus: undefined }),
        items,
      ),
    ).toBe(true);
  });

  it("includes gtin lines; excludes unresolved and needs_confirmation query lines", () => {
    const items: BasketItemInput[] = [
      { gtin: "7290000000000", qty: 1 },
      { query: "מלפפונים", qty: 1 },
      { query: "מלפפונים", qty: 1 },
    ];
    expect(
      isCoverageTarget(resolvedLine({ index: 0, resolvedBy: "gtin", resolutionStatus: undefined }), items),
    ).toBe(true);
    expect(
      isCoverageTarget(
        resolvedLine({ index: 1, resolvedBy: "query", resolutionStatus: "needs_confirmation" }),
        items,
      ),
    ).toBe(false);
    expect(
      isCoverageTarget(
        resolvedLine({
          index: 2,
          resolvedBy: "unresolved",
          productId: null,
          resolutionStatus: "unresolved",
        }),
        items,
      ),
    ).toBe(false);
  });

  it("prefers item.query for peer filtering, else primary.name (product_id-only)", () => {
    const p = primary({ name: "מלפפון שופרסל" });
    expect(coverageQueryText({ query: "מלפפונים", qty: 1 }, p)).toBe("מלפפונים");
    expect(coverageQueryText({ productId: "primary", qty: 1 }, p)).toBe("מלפפון שופרסל");
  });

  it("product_id-only branded name does not block other-chain peers (no query tokens)", () => {
    const p = primary({ name: "עגבניות שופרסל", brandExtracted: "שופרסל", classL3: "tomato" });
    const kept = filterClassPeers(
      "עגבניות שופרסל",
      p,
      [row("a", "עגבניות רמי לוי"), row("b", "עגבניות"), row("c", "מלפפונים")],
      { requireQueryTokens: false },
    );
    // Class peers already SQL-filtered in production; here we only check that
    // brand tokens are not required when requireQueryTokens is false.
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b", "c"]);
  });
});
