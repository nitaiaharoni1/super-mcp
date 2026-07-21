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

describe("applyFastResolutionPolicy generic chicken", () => {
  function unresolvedChicken(candidates: BasketCandidate[]): ResolvedItem {
    return {
      index: 0,
      qty: 1.5,
      qtyMode: "weighted_kg_or_l",
      amount: 1.5,
      unit: "kg",
      productId: null,
      name: "עוף",
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates,
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };
  }

  function meatCand(
    partial: Partial<BasketCandidate> & Pick<BasketCandidate, "productId" | "name">,
  ): BasketCandidate {
    return cand({
      productClass: "meat_chicken",
      classL1: "meat",
      classL2: "chicken",
      classL3: null,
      sizeQty: null,
      sizeUnit: null,
      ...partial,
    });
  }

  it("never selects organ/carcass cuts for bare עוף @ 1.5kg", () => {
    const breast = meatCand({
      productId: "breast",
      name: "חזה עוף טרי",
      score: 0.82,
    });
    const organs = [
      meatCand({ productId: "gizzard", name: "קורקבן עוף טרי", score: 0.96 }),
      meatCand({ productId: "liver", name: "כבד עוף טרי", score: 0.95 }),
      meatCand({ productId: "hearts", name: "לבבות עוף טרי", score: 0.94 }),
      meatCand({ productId: "neck", name: "צוואר עוף טרי", score: 0.93 }),
      meatCand({ productId: "back", name: "גב עוף טרי", score: 0.92 }),
    ];
    const availability = new Map<string, CandidateAvailability>(
      [breast, ...organs].map((c) => [
        c.productId,
        { pricedStoreCount: 8, chainCount: 2, minPrice: 20 },
      ]),
    );

    const result = applyFastResolutionPolicy(
      [{ query: "עוף", amount: 1.5, unit: "kg" }],
      [unresolvedChicken([breast, ...organs])],
      availability,
    );

    expect(result.items[0]?.productId).toBe("breast");
    expect(result.items[0]?.name).toBe("חזה עוף טרי");
    expect(result.items[0]?.resolutionStatus).toBe("resolved");
    for (const bad of ["קורקבן", "כבד", "לבבות", "צוואר", "גב"]) {
      expect(result.items[0]?.name ?? "").not.toContain(bad);
    }
  });

  it("still allows common fresh cuts for bare עוף", () => {
    const cuts = [
      meatCand({ productId: "thigh", name: "שוק עוף טרי", score: 0.9 }),
      meatCand({ productId: "pargiot", name: "פרגיות עוף טרי", score: 0.88 }),
      meatCand({ productId: "wings", name: "כנפיים עוף טרי", score: 0.86 }),
    ];
    const availability = new Map<string, CandidateAvailability>(
      cuts.map((c) => [c.productId, { pricedStoreCount: 6, chainCount: 2, minPrice: 25 }]),
    );

    const result = applyFastResolutionPolicy(
      [{ query: "עוף", amount: 1.5, unit: "kg" }],
      [unresolvedChicken(cuts)],
      availability,
    );

    expect(result.items[0]?.resolutionStatus).toBe("resolved");
    expect(["thigh", "pargiot", "wings"]).toContain(result.items[0]?.productId);
  });

  it("allows explicitly requested organ cut (כבד עוף)", () => {
    const liver = meatCand({ productId: "liver", name: "כבד עוף טרי", score: 0.9 });
    const breast = meatCand({ productId: "breast", name: "חזה עוף טרי", score: 0.85 });
    const availability = new Map<string, CandidateAvailability>([
      ["liver", { pricedStoreCount: 5, chainCount: 2, minPrice: 18 }],
      ["breast", { pricedStoreCount: 5, chainCount: 2, minPrice: 30 }],
    ]);

    const result = applyFastResolutionPolicy(
      [{ query: "כבד עוף", amount: 0.5, unit: "kg" }],
      [
        {
          ...unresolvedChicken([liver, breast]),
          name: "כבד עוף",
        },
      ],
      availability,
    );

    expect(result.items[0]?.productId).toBe("liver");
  });
});
