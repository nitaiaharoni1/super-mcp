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

  it("keeps the dominant class instead of omitting on mixed-class search noise", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "חלב",
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates: [
        cand({
          productId: "body",
          name: "חלב גוף שקדים אורגני",
          classL1: "personal_care",
          productClass: "personal_care",
          score: 0.99,
        }),
        cand({
          productId: "milk",
          name: "חלב טרי 3%",
          classL1: "dairy_eggs",
          productClass: "dairy",
          score: 0.9,
        }),
        cand({
          productId: "milk2",
          name: "חלב תנובה 3%",
          classL1: "dairy_eggs",
          productClass: "dairy",
          score: 0.88,
        }),
      ],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };
    const availability = new Map<string, CandidateAvailability>([
      ["body", { pricedStoreCount: 3, chainCount: 1, minPrice: 20 }],
      ["milk", { pricedStoreCount: 8, chainCount: 3, minPrice: 7 }],
      ["milk2", { pricedStoreCount: 8, chainCount: 3, minPrice: 8 }],
    ]);
    const result = applyFastResolutionPolicy([{ query: "חלב", packQty: 1 }], [item], availability);
    expect(result.items[0]?.resolutionStatus).toBe("resolved");
    expect(["milk", "milk2"]).toContain(result.items[0]?.productId);
    expect(result.items[0]?.name ?? "").not.toContain("גוף");
  });
});

describe("applyFastResolutionPolicy generic milk", () => {
  it("never selects condensed/sweetened milk for bare חלב", () => {
    const fresh = cand({
      productId: "fresh",
      name: "חלב טרי 3%",
      score: 0.85,
    });
    const traps = [
      cand({
        productId: "condensed",
        name: "חלב מרוכז וממותק וילי פוד 397 גרם",
        score: 0.99,
      }),
      cand({
        productId: "powder",
        name: "אבקת חלב דל שומן",
        score: 0.95,
      }),
      cand({
        productId: "flavored",
        name: "חלב בטעם שוקולד",
        score: 0.94,
      }),
    ];
    const availability = new Map<string, CandidateAvailability>(
      [fresh, ...traps].map((c) => [
        c.productId,
        { pricedStoreCount: 8, chainCount: 3, minPrice: 7 },
      ]),
    );
    const item: ResolvedItem = {
      index: 0,
      qty: 3,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "חלב",
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates: [fresh, ...traps],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };
    const result = applyFastResolutionPolicy(
      [{ query: "חלב", packQty: 3 }],
      [item],
      availability,
    );
    expect(result.items[0]?.productId).toBe("fresh");
    expect(result.items[0]?.name).toBe("חלב טרי 3%");
  });

  it("re-selects when commodity auto-resolve already locked condensed milk", () => {
    const condensed = cand({
      productId: "condensed",
      name: "חלב מרוכז וממותק וילי פוד 397 גרם",
      score: 0.99,
    });
    const fresh = cand({
      productId: "fresh",
      name: "חלב תנובה 3%",
      score: 0.8,
      brandExtracted: "תנובה",
    });
    const availability = new Map<string, CandidateAvailability>([
      ["condensed", { pricedStoreCount: 8, chainCount: 3, minPrice: 12 }],
      ["fresh", { pricedStoreCount: 8, chainCount: 3, minPrice: 7 }],
    ]);
    const alreadyResolved: ResolvedItem = {
      index: 0,
      qty: 3,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "condensed",
      name: condensed.name,
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.99,
      lowConfidence: false,
      candidates: [condensed, fresh],
      primaryProductId: "condensed",
      primaryName: condensed.name,
      substitution: null,
    };
    const result = applyFastResolutionPolicy(
      [{ query: "חלב", packQty: 3 }],
      [alreadyResolved],
      availability,
    );
    expect(result.items[0]?.productId).toBe("fresh");
    expect(result.items[0]?.name ?? "").not.toContain("מרוכז");
  });

  it("re-selects when auto-resolve locked halvah or body lotion for bare חלב", () => {
    const halvah = cand({
      productId: "halvah",
      name: "חלבה במשקל",
      score: 0.99,
      classL1: "snacks_sweets",
      productClass: "confectionery",
    });
    const lotion = cand({
      productId: "lotion",
      name: "חלב גוף שקדים אורגני",
      score: 0.98,
      classL1: "personal_care",
      productClass: "personal_care",
    });
    const fresh = cand({
      productId: "fresh",
      name: "חלב טרי 3%",
      score: 0.8,
    });
    const availability = new Map<string, CandidateAvailability>(
      [halvah, lotion, fresh].map((c) => [
        c.productId,
        { pricedStoreCount: 8, chainCount: 3, minPrice: 8 },
      ]),
    );

    for (const trap of [halvah, lotion]) {
      const alreadyResolved: ResolvedItem = {
        index: 0,
        qty: 3,
        qtyMode: "packs",
        amount: null,
        unit: null,
        productId: trap.productId,
        name: trap.name,
        resolvedBy: "query",
        resolutionStatus: "resolved",
        confidence: 0.99,
        lowConfidence: false,
        candidates: [trap, fresh],
        primaryProductId: trap.productId,
        primaryName: trap.name,
        substitution: null,
      };
      const result = applyFastResolutionPolicy(
        [{ query: "חלב", packQty: 3 }],
        [alreadyResolved],
        availability,
      );
      expect(result.items[0]?.productId, trap.name).toBe("fresh");
    }
  });

  it("keeps condensed milk when the query explicitly asks for חלב מרוכז", () => {
    const condensed = cand({
      productId: "condensed",
      name: "חלב מרוכז וממותק",
      score: 0.95,
    });
    const fresh = cand({
      productId: "fresh",
      name: "חלב טרי 3%",
      score: 0.9,
    });
    const availability = new Map<string, CandidateAvailability>([
      ["condensed", { pricedStoreCount: 8, chainCount: 2, minPrice: 12 }],
      ["fresh", { pricedStoreCount: 8, chainCount: 2, minPrice: 7 }],
    ]);
    const result = applyFastResolutionPolicy(
      [{ query: "חלב מרוכז", packQty: 1 }],
      [
        {
          index: 0,
          qty: 1,
          qtyMode: "packs",
          amount: null,
          unit: null,
          productId: null,
          name: "חלב מרוכז",
          resolvedBy: "unresolved",
          resolutionStatus: "needs_confirmation",
          confidence: null,
          lowConfidence: true,
          candidates: [condensed, fresh],
          primaryProductId: null,
          primaryName: null,
          substitution: null,
        },
      ],
      availability,
    );
    expect(result.items[0]?.productId).toBe("condensed");
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
      meatCand({ productId: "throat", name: "גרון עוף לולו", score: 0.925 }),
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
    for (const bad of ["קורקבן", "כבד", "לבבות", "צוואר", "גרון", "גב"]) {
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

  it("allows explicitly requested processed chicken (שניצל עוף)", () => {
    const schnitzel = meatCand({
      productId: "schnitzel",
      name: "שניצל עוף טרי",
      score: 0.95,
    });
    const breast = meatCand({ productId: "breast", name: "חזה עוף טרי", score: 0.9 });
    const availability = new Map<string, CandidateAvailability>([
      ["schnitzel", { pricedStoreCount: 6, chainCount: 2, minPrice: 35 }],
      ["breast", { pricedStoreCount: 6, chainCount: 2, minPrice: 30 }],
    ]);

    const result = applyFastResolutionPolicy(
      [{ query: "שניצל עוף", amount: 0.5, unit: "kg" }],
      [
        {
          ...unresolvedChicken([schnitzel, breast]),
          name: "שניצל עוף",
        },
      ],
      availability,
    );

    expect(result.items[0]?.productId).toBe("schnitzel");
  });

  it("re-selects when commodity auto-resolve already locked an organ/processed cut", () => {
    const liver = meatCand({ productId: "liver", name: "כבד עוף טרי - כשר", score: 0.95 });
    const schnitzel = meatCand({
      productId: "schnitzel",
      name: "עוף טוב אצבעות שניצל",
      score: 0.93,
    });
    const breast = meatCand({ productId: "breast", name: "חזה עוף טרי", score: 0.82 });
    const availability = new Map<string, CandidateAvailability>(
      [liver, schnitzel, breast].map((c) => [
        c.productId,
        { pricedStoreCount: 8, chainCount: 2, minPrice: 20 },
      ]),
    );

    const alreadyResolved: ResolvedItem = {
      ...unresolvedChicken([liver, schnitzel, breast]),
      productId: "liver",
      name: "כבד עוף טרי - כשר",
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.95,
      lowConfidence: false,
    };

    const result = applyFastResolutionPolicy(
      [{ query: "עוף", amount: 1.5, unit: "kg" }],
      [alreadyResolved],
      availability,
    );

    expect(result.items[0]?.productId).toBe("breast");
    expect(result.items[0]?.name).toBe("חזה עוף טרי");
    for (const bad of ["קורקבן", "כבד", "שניצל", "אצבעות"]) {
      expect(result.items[0]?.name ?? "").not.toContain(bad);
    }
  });
});
