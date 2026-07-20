import { heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchProductHit } from "../../../src/services/search/types.js";

const getActiveOntology = vi.fn();
const loadSemanticProfiles = vi.fn();
const searchProductsScored = vi.fn();

vi.mock("../../../src/services/search/index.js", () => ({
  activeOntologyVersion: () => "test-ontology",
  getActiveOntology: (...args: unknown[]) => getActiveOntology(...args),
  loadSemanticProfiles: (...args: unknown[]) => loadSemanticProfiles(...args),
  mergeSearchHits: (batches: SearchProductHit[][]) => batches.flat(),
  searchProductsScored: (...args: unknown[]) => searchProductsScored(...args),
  searchQueriesForIntent: (query: string) => [query],
}));

vi.mock("../../../src/lib/features.js", () => ({
  semanticBasketEnabled: () => true,
  semanticBasketShadow: () => false,
  semanticV2RecallEnabled: () => true,
  semanticV2Shadow: () => false,
}));

import { rankQueryCandidates } from "../../../src/services/basket/rankQueryCandidates.js";
import { resolveQueryItem } from "../../../src/services/basket/resolveQuery.js";
import type { ProductClassInfo } from "../../../src/services/basket/productClasses.js";

/** A lexical hit; evidence overrides let a case force exact/vector recall. */
function hit(
  id: string,
  name: string,
  lexicalScore: number,
  over: Partial<SearchProductHit> & { evidence?: Partial<SearchProductHit["evidence"]> } = {},
): SearchProductHit {
  const { evidence: evidenceOver, ...rest } = over;
  return {
    id,
    gtin: null,
    name,
    brand: null,
    categoryL1: null,
    categoryL2: null,
    sizeQty: null,
    sizeUnit: null,
    score: lexicalScore,
    lexicalScore,
    matchedVia: "product",
    hasPrice: true,
    hasLocalPrice: true,
    ...rest,
    evidence: {
      exactName: false,
      exactPhrase: true,
      matchedTokenCount: 1,
      queryTokenCount: 1,
      trigramSimilarity: null,
      aliasMatched: false,
      vectorDistance: null,
      lexicalScore,
      ...evidenceOver,
    },
  };
}

async function resolveLine(query: string, hits: SearchProductHit[]) {
  searchProductsScored.mockImplementation(({ q }: { q: string }) => (q === query ? hits : []));
  return resolveQueryItem(
    { query },
    { index: 0, amount: null, unit: null },
    { city: "הרצליה" },
    false,
  );
}

describe("resolveQuery risk + equivalence wiring", () => {
  beforeEach(() => {
    getActiveOntology.mockResolvedValue(heRetailOntologyFixture());
    loadSemanticProfiles.mockResolvedValue(new Map());
  });

  it("commodity line with same-class near-duplicates auto-resolves with equivalents attached", async () => {
    // Three tier-1 produce SKUs, distinct product lines, equal lexical scores:
    // margin-ambiguous -> needs_confirmation today. Same class -> commodity.
    const item = await resolveLine("עגבניות", [
      hit("t1", "עגבניות חממה", 0.9),
      hit("t2", 'עגבניה תמ"י', 0.9),
      hit("t3", "עגבניות שרי אדומות", 0.9),
    ]);

    expect(item.resolutionStatus).toBe("resolved");
    expect(item.productId).toBe("t1");
    expect(item.lowConfidence).toBe(false);
    expect(item.equivalents).toBeDefined();
    expect(item.equivalents!.length).toBeGreaterThanOrEqual(2);
  });

  it("brand-pinned line whose chosen candidate is NOT the pinned brand needs confirmation", async () => {
    // The query pins "טסטרס צויס"; the top pick that would resolve is עלית.
    // Brand pinning may only DOWNGRADE resolved -> needs_confirmation.
    const item = await resolveLine("קפה טסטרס צויס", [
      hit("elite", "קפה נמס עלית", 0.95, {
        brand: "עלית",
        evidence: { exactName: true, exactPhrase: true, queryTokenCount: 3, matchedTokenCount: 3 },
      }),
      hit("tasters", "קפה נמס טסטרס צ'ויס", 0.6, { brand: "טסטרס צ'ויס" }),
    ]);

    expect(item.resolutionStatus).toBe("needs_confirmation");
    expect(item.productId).toBeNull();
    // The exact-brand candidate is surfaced first for the confirmation.
    expect(item.candidates[0]?.productId).toBe("tasters");
  });

  it("cross-class line (drink vs candy) needs confirmation and gets no equivalents", async () => {
    // An unconstrained query keeps candidates from two product classes in the
    // shortlist (a class-pinned query like "קולה" would gate the candy out).
    // Two beverage colas at equal scores make the base decision ambiguous, and
    // the candy adds a second class -> cross_class, so the commodity override
    // must NOT fire: the line still needs a human to say drink vs candy.
    const item = await resolveLine("מוצר", [
      hit("drink1", "משקה קולה קל", 0.9),
      hit("drink2", "קולה קוקה בקבוק", 0.9),
      hit("candy", "סוכריות גומי קולה", 0.9),
    ]);

    expect(item.resolutionStatus).toBe("needs_confirmation");
    expect(item.productId).toBeNull();
    expect(item.equivalents).toBeUndefined();
  });

  it("never auto-resolves a vector-only top candidate via the commodity override", async () => {
    // Both candidates are the SAME class (commodity) and would build a valid
    // equivalence set, but the top pick is vector-only (no lexical evidence).
    // The invariant "vector-only never auto-prices" must block the override.
    const vecEvidence = {
      exactName: false,
      exactPhrase: false,
      matchedTokenCount: 0,
      queryTokenCount: 1,
      lexicalScore: null,
    };
    const item = await resolveLine("עגבניות", [
      hit("vec1", "עגבניות אורגניות", 0, {
        matchedVia: "vector",
        vectorDistance: 0.12,
        lexicalScore: null,
        score: 0.02,
        evidence: vecEvidence,
      }),
      hit("vec2", "עגבניות שרי", 0, {
        matchedVia: "vector",
        vectorDistance: 0.15,
        lexicalScore: null,
        score: 0.02,
        evidence: vecEvidence,
      }),
    ]);

    expect(item.resolutionStatus).toBe("needs_confirmation");
    expect(item.productId).toBeNull();
    expect(item.equivalents).toBeUndefined();
  });

  it("לימונים never auto-prices lemon cake via commodity/availability override", async () => {
    const item = await resolveLine("לימונים", [
      hit("cake", "עוגת לימונים 600 גרם", 0.99, {
        sizeQty: 600,
        sizeUnit: "g",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
      hit("lemon", "לימון טרי", 0.95, {
        sizeQty: 1,
        sizeUnit: "kg",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
      hit("lemon2", "לימונים ארוזים", 0.94, {
        sizeQty: 1,
        sizeUnit: "kg",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
    ]);

    expect(item.name).not.toMatch(/עוגת/);
    expect(item.candidates[0]?.name).not.toMatch(/עוגת/);
    expect(item.productId).not.toBe("cake");
    expect(item.equivalents?.some((e) => e.name.includes("עוגת")) ?? false).toBe(false);
  });

  it("קולה never auto-prices licorice candy via override", async () => {
    const item = await resolveLine("קולה", [
      hit("licorice", "לקריץ קולה מסוכר במשקל", 1, {
        sizeQty: 1000,
        sizeUnit: "g",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
      hit("cola1", "קוקה קולה בקבוק", 0.95, {
        sizeQty: 1500,
        sizeUnit: "ml",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
      hit("cola2", "RC קולה", 0.94, {
        sizeQty: 1500,
        sizeUnit: "ml",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
    ]);

    expect(item.name).not.toMatch(/לקריץ/);
    if (item.productId) expect(item.name).not.toMatch(/לקריץ/);
  });

  it("bare יין auto-resolves to a good-enough bottle with interchangeable peers", async () => {
    const item = await resolveLine("יין", [
      hit("w1", "יין אדום קברנה סוביניון", 0.95, {
        sizeQty: 750,
        sizeUnit: "ml",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
      hit("w2", "יין אדום מרלו", 0.94, {
        sizeQty: 750,
        sizeUnit: "ml",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
      hit("w3", "יין לבן שרדונה", 0.93, {
        sizeQty: 750,
        sizeUnit: "ml",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      }),
    ]);

    expect(item.resolutionStatus).toBe("resolved");
    expect(item.productId).toBe("w1");
    expect(item.equivalents).toBeDefined();
    expect(item.equivalents!.length).toBeGreaterThanOrEqual(2);
    expect(item.name).not.toMatch(/חולץ|פותחן/);
  });

  it("bare יין ignores utensil peers that would otherwise create cross_class", () => {
    // Live shortlists mix bottles (alcohol) with openers (household). Risk/override
    // must score only head-anchored bottles so bare יין can auto-pick a good-enough wine.
    const ontology = heRetailOntologyFixture();
    const wine = (id: string, name: string, score: number) =>
      hit(id, name, score, {
        sizeQty: 750,
        sizeUnit: "ml",
        evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
      });
    const classMap = new Map<string, ProductClassInfo>([
      [
        "cork",
        { l1: "household", l2: "utensils", l3: null, variant: null, brand: null },
      ],
      [
        "w1",
        {
          l1: "alcohol",
          l2: "wine",
          l3: "red_wine",
          variant: "regular",
          brand: "קברנה",
        },
      ],
      [
        "w2",
        {
          l1: "alcohol",
          l2: "wine",
          l3: "red_wine",
          variant: "regular",
          brand: "מרלו",
        },
      ],
    ]);

    const item = rankQueryCandidates(
      {
        item: { query: "יין" },
        base: { index: 0, amount: null, unit: null },
        hasAmount: false,
        wantsPackSize: false,
        hits: [
          hit("cork", "חולץ יין מלצרים", 0.97, {
            evidence: { exactPhrase: true, matchedTokenCount: 1, queryTokenCount: 1 },
          }),
          wine("w1", "יין אדום קברנה סוביניון", 0.95),
          wine("w2", "יין אדום מרלו", 0.94),
        ],
        searchMs: 0,
        candidateLimit: 20,
        semantic: true,
        ontology,
        location: { city: "הרצליה" },
      },
      new Map(),
      { classMap },
    );

    expect(item.resolutionStatus).toBe("resolved");
    expect(item.productId).toBe("w1");
    expect(item.name).not.toMatch(/חולץ|פותחן/);
    expect(item.equivalents?.length).toBeGreaterThanOrEqual(2);
  });
});
