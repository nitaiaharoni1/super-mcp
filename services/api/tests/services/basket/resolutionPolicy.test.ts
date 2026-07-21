import { buildQueryProfile } from "@super-mcp/shared";
import { heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { describe, expect, it } from "vitest";
import { filterSafeCandidates } from "../../../src/services/basket/rankQueryCandidates.js";
import { applyFastResolutionPolicy } from "../../../src/services/basket/resolutionPolicy.js";
import type {
  BasketCandidate,
  CandidateAvailability,
  ResolvedItem,
} from "../../../src/services/basket/types.js";

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

function unresolvedMilk(): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: null,
    name: "חלב תנובה",
    resolvedBy: "query",
    resolutionStatus: "needs_confirmation",
    confidence: null,
    lowConfidence: true,
    candidates: [
      cand({ productId: "other", name: "חלב טרה 3%", brandExtracted: "טרה", score: 0.95 }),
      cand({ productId: "match", name: "חלב תנובה 3%", brandExtracted: "תנובה", score: 0.9 }),
    ],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

describe("applyFastResolutionPolicy hard attributes", () => {
  const ontology = heRetailOntologyFixture();

  it("builds ontology hard attrs (brand) for filterSafeCandidates", () => {
    const profile = buildQueryProfile("חלב תנובה", ontology);
    expect(profile.attributes.brand).toBe("תנובה");
    const safe = filterSafeCandidates({
      query: "חלב תנובה",
      profile,
      candidates: unresolvedMilk().candidates,
    });
    expect(safe.map((c) => c.productId)).toEqual(["match"]);
  });

  it("selects brand-compatible candidate under fast policy with ontology", () => {
    const availability = new Map<string, CandidateAvailability>([
      ["other", { pricedStoreCount: 5, chainCount: 2, minPrice: 8 }],
      ["match", { pricedStoreCount: 4, chainCount: 2, minPrice: 9 }],
    ]);
    const result = applyFastResolutionPolicy(
      [{ query: "חלב תנובה" }],
      [unresolvedMilk()],
      availability,
      ontology,
    );
    expect(result.items[0]?.productId).toBe("match");
    expect(result.items[0]?.resolutionStatus).toBe("resolved");
  });

  it("omits when brand hard constraint leaves no safe local candidate", () => {
    const item = unresolvedMilk();
    item.candidates = [
      cand({ productId: "other", name: "חלב טרה 3%", brandExtracted: "טרה", score: 0.95 }),
    ];
    const availability = new Map<string, CandidateAvailability>([
      ["other", { pricedStoreCount: 5, chainCount: 2, minPrice: 8 }],
    ]);
    const result = applyFastResolutionPolicy(
      [{ query: "חלב תנובה" }],
      [item],
      availability,
      ontology,
    );
    expect(result.items[0]?.productId).toBeNull();
    expect(result.assumptions[0]?.reason).toBe("unsafe_line_omitted");
  });
});
