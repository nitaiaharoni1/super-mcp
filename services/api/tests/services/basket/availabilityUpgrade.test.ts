import { heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { describe, expect, it } from "vitest";
import { applyFastResolutionPolicy } from "../../../src/services/basket/resolutionPolicy.js";
import type {
  BasketCandidate,
  BasketItemInput,
  CandidateAvailability,
  ResolvedItem,
} from "../../../src/services/basket/types.js";

/**
 * Resolution ranks on name-match score, and score is a float that never ties, so
 * the store-coverage tiebreaker inside `rankSafeCandidatesForFast` could never
 * fire — and lines that arrived already "resolved" skipped availability entirely.
 * On the live catalog that produced `חלב 3%` in 1 of 159 nearby stores while an
 * equally valid milk sat in 73, and `ביצים L` on a SKU carried by ZERO stores.
 */

function cand(
  partial: Partial<BasketCandidate> & Pick<BasketCandidate, "productId" | "name">,
): BasketCandidate {
  return {
    score: 0.9,
    matchedVia: "product",
    sizeQty: 1,
    sizeUnit: "L",
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "dairy",
    classL1: "dairy_eggs",
    classL2: "milk",
    classL3: null,
    variant: "regular",
    brandExtracted: null,
    intentTier: 1,
    ...partial,
  };
}

function availability(
  entries: Array<[string, number]>,
): Map<string, CandidateAvailability> {
  return new Map(
    entries.map(([productId, pricedStoreCount]) => [
      productId,
      { pricedStoreCount, chainCount: Math.min(pricedStoreCount, 5), minPrice: 6 },
    ]),
  );
}

/** A line the resolver already settled, as it reaches the fast policy. */
function resolvedLine(
  productId: string,
  name: string,
  candidates: BasketCandidate[],
): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId,
    name,
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 0.95,
    lowConfidence: false,
    candidates,
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

const ontology = heRetailOntologyFixture();

describe("availability upgrade on already-resolved lines", () => {
  it("moves a barely-stocked primary onto a widely-stocked peer", () => {
    const rare = cand({ productId: "rare", name: "חלב 3% בקרטון 1 ליטר", score: 0.97 });
    const common = cand({ productId: "common", name: "חלב 3% מהדרין שקית 1 ל", score: 0.93 });
    const items: BasketItemInput[] = [{ query: "חלב 3%", packQty: 1 }];

    const result = applyFastResolutionPolicy(
      items,
      [resolvedLine("rare", rare.name, [rare, common])],
      availability([
        ["rare", 1],
        ["common", 73],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("common");
    expect(result.items[0]?.resolutionStatus).toBe("resolved");
    // The swap is disclosed, never silent.
    expect(result.assumptions[0]?.selectedProductId).toBe("common");
  });

  it("moves off an UNCLASSIFIED primary onto a classified peer of equal standing", () => {
    // An unclassified SKU can never gain equivalents: enrichCommodityCoverage
    // needs a class to find the peers each storefront actually stocks, so its
    // store count is a CEILING. A classified peer's count is a floor — every
    // storefront can fill the line with its own same-class SKU. That asymmetry is
    // invisible to the 3x coverage rule, so a bare "מייפל" line pinned to an
    // unclassified organic maple carried by one storefront and was reported
    // not_carried_by_chain everywhere else, while classified maple syrups sat
    // priced at four of them.
    const orphan = cand({
      productId: "orphan",
      name: 'מייפל אורגני טהור 100% 236 מ"ל',
      score: 0.95,
      classL1: null,
      classL2: null,
      classL3: null,
      variant: null,
    });
    const classified = cand({
      productId: "classified",
      name: 'סירופ מייפל טבעי 250 מ"ל',
      score: 0.94,
      classL1: "spreads_condiments",
      classL2: "honey_jam",
      classL3: "maple_syrup",
    });

    const result = applyFastResolutionPolicy(
      [{ query: "מייפל", packQty: 1 }],
      [resolvedLine("orphan", orphan.name, [orphan, classified])],
      availability([
        ["orphan", 2],
        ["classified", 3],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("classified");
  });

  it("keeps an unclassified primary when it is the better-covered option anyway", () => {
    const orphan = cand({
      productId: "orphan",
      name: 'מייפל אורגני טהור 100% 236 מ"ל',
      score: 0.95,
      classL1: null,
      classL2: null,
      classL3: null,
      variant: null,
    });
    const classified = cand({
      productId: "classified",
      name: 'סירופ מייפל טבעי 250 מ"ל',
      score: 0.94,
      classL1: "spreads_condiments",
      classL2: "honey_jam",
      classL3: "maple_syrup",
    });

    const result = applyFastResolutionPolicy(
      [{ query: "מייפל", packQty: 1 }],
      [resolvedLine("orphan", orphan.name, [orphan, classified])],
      availability([
        ["orphan", 40],
        ["classified", 2],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("orphan");
  });

  it("leaves the primary alone when coverage is only marginally better", () => {
    // 700 vs 780 stores is jitter between two widely-stocked SKUs; the better name
    // match must still win.
    const better = cand({ productId: "better", name: "חלב 3% תנובה 1 ליטר", score: 0.97 });
    const other = cand({ productId: "other", name: "חלב 3% טרה 1 ליטר", score: 0.93 });

    const result = applyFastResolutionPolicy(
      [{ query: "חלב 3%", packQty: 1 }],
      [resolvedLine("better", better.name, [better, other])],
      availability([
        ["better", 700],
        ["other", 780],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("better");
  });

  it("never drifts off a peer that fails the shopper's own words", () => {
    // The ontology extracts NO attributes from "חמאה לה גאל" — it does not know the
    // brand — so specificity has to come from the query tokens themselves.
    const leGall = cand({
      productId: "legall",
      name: "חמאה 250גרם לה גאל",
      score: 0.95,
      classL2: "butter",
      sizeQty: 250,
      sizeUnit: "g",
    });
    const tnuva = cand({
      productId: "tnuva",
      name: "חמאה תנובה 200 גרם מהדרין",
      score: 0.9,
      classL2: "butter",
      sizeQty: 200,
      sizeUnit: "g",
    });

    const result = applyFastResolutionPolicy(
      [{ query: "חמאה לה גאל", packQty: 1 }],
      [resolvedLine("legall", leGall.name, [leGall, tnuva])],
      availability([
        ["legall", 2],
        ["tnuva", 762],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("legall");
  });

  it("never overrides a product the shopper pinned by id", () => {
    const pinned = cand({ productId: "pinned", name: "חלב 3% בקרטון 1 ליטר" });
    const common = cand({ productId: "common", name: "חלב 3% מהדרין שקית 1 ל" });
    const line = {
      ...resolvedLine("pinned", pinned.name, [pinned, common]),
      resolvedBy: "product_id" as const,
    };

    const result = applyFastResolutionPolicy(
      [{ productId: "pinned", packQty: 1 }],
      [line],
      availability([
        ["pinned", 1],
        ["common", 500],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("pinned");
  });

  it("does not promote a 2-store SKU over a 1-store SKU on a bare ratio", () => {
    // 2 is 2x of 1 but still nothing; the absolute floor keeps the name match.
    const primary = cand({ productId: "primary", name: "חלב 3% בקרטון 1 ליטר", score: 0.97 });
    const other = cand({ productId: "other", name: "חלב 3% שקית 1 ליטר", score: 0.9 });

    const result = applyFastResolutionPolicy(
      [{ query: "חלב 3%", packQty: 1 }],
      [resolvedLine("primary", primary.name, [primary, other])],
      availability([
        ["primary", 1],
        ["other", 2],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("primary");
  });
});
