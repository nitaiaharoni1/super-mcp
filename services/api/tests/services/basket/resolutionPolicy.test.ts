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

  it("says so when no product carries all the query's words", () => {
    // "דבש מייפל" is two shopping-list items glued into one line. No SKU is maple
    // honey, so search fell back to vector noise (honey cake, honey liqueur,
    // pastrami in honey) and the line was dropped with the same wording used for a
    // product that exists but is not stocked nearby. The caller cannot tell those
    // apart, so it cannot learn to split the line.
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "דבש מייפל",
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates: [
        cand({
          productId: "liqueur",
          name: "ליקר טנסי דבש",
          score: 0.02,
          classL1: "alcohol",
          classL2: "liqueur",
        }),
        cand({
          productId: "pastrami",
          name: "פסטרמה בדבש",
          score: 0.01,
          classL1: "meat_fish",
          classL2: "meat_processed",
        }),
      ],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };
    const result = applyFastResolutionPolicy(
      [{ query: "דבש מייפל" }],
      [item],
      new Map<string, CandidateAvailability>(),
      ontology,
    );
    expect(result.items[0]?.productId).toBeNull();
    expect(result.assumptions[0]?.reason).toBe("query_matches_no_product");
    expect(result.assumptions[0]?.message).toContain("separate lines");
  });

  it("keeps the ordinary omission reason when the product exists but is not stocked", () => {
    const item = unresolvedMilk();
    item.candidates = [
      cand({ productId: "other", name: "חלב טרה 3%", brandExtracted: "טרה", score: 0.95 }),
    ];
    const result = applyFastResolutionPolicy(
      [{ query: "חלב תנובה" }],
      [item],
      new Map<string, CandidateAvailability>([
        ["other", { pricedStoreCount: 5, chainCount: 2, minPrice: 8 }],
      ]),
      ontology,
    );
    expect(result.assumptions[0]?.reason).toBe("unsafe_line_omitted");
  });

  it("lets the taxonomy re-admit a same-leaf peer the head-anchor window cut off", () => {
    // queryHeadAnchored only inspects a name's first TWO tokens, so a brand-led
    // name buries the commodity word out of reach: "מיימונס סירופ מייפל אמיתי
    // 100% מקנדה" is real Canadian maple at five storefronts and does not anchor
    // for "מייפל". The line was left with organic imports carried by one.
    //
    // Head anchoring is a NAME-based proxy for "same kind of thing". Where the
    // taxonomy answers that question outright — same L3 leaf — the proxy is
    // redundant and only does harm. A host product (bakery/cake for "לימונים")
    // never shares the leaf, so the guard keeps its teeth.
    const organic = cand({
      productId: "organic",
      name: 'מייפל אורגני טהור 100% 236 מ"ל',
      score: 0.95,
      variant: "organic",
      classL1: "spreads_condiments",
      classL2: "honey_jam",
      classL3: "maple_syrup",
    });
    const stocked = cand({
      productId: "stocked",
      name: 'מיימונס סירופ מייפל אמיתי 100% מקנדה 236 מ"ל',
      score: 0.88,
      variant: "regular",
      classL1: "spreads_condiments",
      classL2: "honey_jam",
      classL3: "maple_syrup",
    });
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "מייפל",
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates: [organic, stocked],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };

    const result = applyFastResolutionPolicy(
      [{ query: "מייפל", packQty: 1 }],
      [item],
      new Map<string, CandidateAvailability>([
        ["organic", { pricedStoreCount: 1, chainCount: 1, minPrice: 35 }],
        ["stocked", { pricedStoreCount: 5, chainCount: 4, minPrice: 10 }],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("stocked");
  });

  it("still refuses a host product that merely contains the query word", () => {
    const lemon = cand({
      productId: "lemon",
      name: "לימון",
      score: 0.95,
      classL1: "produce",
      classL2: "fruit_fresh",
      classL3: "lemon",
    });
    const cake = cand({
      productId: "cake",
      name: "עוגת לימונים במילוי קרם",
      score: 0.9,
      classL1: "bakery",
      classL2: "cake",
      classL3: null,
    });
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "לימונים",
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates: [lemon, cake],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };

    const result = applyFastResolutionPolicy(
      [{ query: "לימונים", packQty: 1 }],
      [item],
      new Map<string, CandidateAvailability>([
        ["lemon", { pricedStoreCount: 2, chainCount: 1, minPrice: 5 }],
        ["cake", { pricedStoreCount: 90, chainCount: 9, minPrice: 20 }],
      ]),
      ontology,
    );

    expect(result.items[0]?.productId).toBe("lemon");
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

describe("the dominant class is the pool's majority, not its first classified row", () => {
  // Regression: the seed used to be `candidates.find((c) => c.classL1)`, i.e.
  // rank order, i.e. whichever candidate the exact-name arm of the search score
  // put first. On the live catalog "שמן" led with `שמן אלוורה 200 מל דר פישר`,
  // an aloe-vera skin oil, so cosmetics became the class and all seventeen
  // cooking oils were filtered out. The pool left this function holding ONE
  // candidate, the availability upgrade had nothing to move to, and the basket
  // bought tanning oil.
  function oil(
    id: string,
    name: string,
    classL1: string,
    classL2: string,
    hasLocalPrice = true,
  ): BasketCandidate {
    return cand({
      productId: id,
      name,
      classL1,
      classL2,
      productClass: classL1,
      hasLocalPrice,
      sizeQty: 750,
      sizeUnit: "ml",
    });
  }

  function oilLine(candidates: BasketCandidate[]): ResolvedItem {
    return {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: candidates[0]!.productId,
      name: candidates[0]!.name,
      resolvedBy: "query",
      confidence: 1,
      lowConfidence: false,
      resolutionStatus: "resolved",
      candidates,
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    } as ResolvedItem;
  }

  it("does not let one mislabelled top hit dictate the class", () => {
    const candidates = [
      oil("cosmetic", "שמן אלוורה 200 מל דר פישר", "personal_care", "cosmetics"),
      ...Array.from({ length: 8 }, (_, i) =>
        oil(`food-${i}`, `שמן קנולה ${i} 1 ליטר`, "pantry", "oil_vinegar"),
      ),
    ];
    const availability = new Map<string, CandidateAvailability>(
      candidates.map((c) => [
        c.productId,
        {
          pricedStoreCount: c.productId === "cosmetic" ? 14 : 120,
          chainCount: c.productId === "cosmetic" ? 1 : 5,
          minPrice: 10,
        },
      ]),
    );

    const result = applyFastResolutionPolicy(
      [{ query: "שמן", packQty: 1 }],
      [oilLine(candidates)],
      availability,
    );

    const chosen = result.items[0]!;
    expect(chosen.productId).not.toBe("cosmetic");
    expect(chosen.name).toContain("קנולה");
  });

  it("leaves a genuinely split pool alone rather than guessing", () => {
    // Four and four is the labels disagreeing, not half the pool being the wrong
    // food. Narrowing here is what cost חומוס and אבקת כביסה their better-stocked
    // peers when the L2 pass tried it.
    const candidates = [
      ...Array.from({ length: 4 }, (_, i) =>
        oil(`a-${i}`, `שמן זית ${i} 750 מל`, "pantry", "oil_vinegar"),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        oil(`b-${i}`, `שמן רחצה ${i} 750 מל`, "personal_care", "cosmetics"),
      ),
    ];
    const availability = new Map<string, CandidateAvailability>(
      candidates.map((c) => [
        c.productId,
        { pricedStoreCount: 50, chainCount: 3, minPrice: 10 },
      ]),
    );
    const result = applyFastResolutionPolicy(
      [{ query: "שמן", packQty: 1 }],
      [oilLine(candidates)],
      availability,
    );
    // Nothing is 3x better stocked, so the line keeps its primary either way;
    // what matters is that the run did not throw away one half of the pool.
    expect(result.items[0]!.productId).toBe("a-0");
  });
});

describe("a query that names its own concept beats a plurality of search hits", () => {
  const ontology = heRetailOntologyFixture();

  function bagsLine(): ResolvedItem {
    return {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "שקיות זבל",
      resolvedBy: "query",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      // What search actually returns for "שקיות זבל": the ziplock bags outrank
      // the bin liners, because the catalogue files those under "אשפה" and only
      // the ziplock names share the typed word "שקיות".
      candidates: [
        cand({
          productId: "zip1", name: "שקיות זיפר L", score: 0.95,
          productClass: "household", classL1: "household", classL2: "disposables",
          classL3: "food_storage_bags", sizeUnit: "unit",
        }),
        cand({
          productId: "zip2", name: "שקיות זיפר סגירה כפולה", score: 0.94,
          productClass: "household", classL1: "household", classL2: "disposables",
          classL3: "food_storage_bags", sizeUnit: "unit",
        }),
        cand({
          productId: "waste", name: "שקיות אשפה גדולות 20 יחידות", score: 0.6,
          productClass: "household", classL1: "household", classL2: "disposables",
          classL3: "waste_bags", sizeUnit: "unit",
        }),
      ],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };
  }

  const availability = new Map<string, CandidateAvailability>([
    ["zip1", { pricedStoreCount: 9, chainCount: 3, minPrice: 16.7 }],
    ["zip2", { pricedStoreCount: 8, chainCount: 3, minPrice: 15 }],
    ["waste", { pricedStoreCount: 7, chainCount: 3, minPrice: 19.9 }],
  ]);

  it("picks the bin liners even though ziplock outranks and outnumbers them", () => {
    const result = applyFastResolutionPolicy(
      [{ query: "שקיות זבל" }],
      [bagsLine()],
      availability,
      ontology,
    );
    expect(result.items[0]?.productId).toBe("waste");
  });

  it("leaves the pool alone when nothing in it matches the hint", () => {
    // Narrowing to an empty set would turn a mediocre answer into no answer, so
    // the hint yields when the concept simply is not on offer.
    const line = bagsLine();
    line.candidates = line.candidates.filter((c) => c.classL3 === "food_storage_bags");
    const result = applyFastResolutionPolicy(
      [{ query: "שקיות זבל" }],
      [line],
      availability,
      ontology,
    );
    expect(result.items[0]?.productId).not.toBeNull();
  });
});
