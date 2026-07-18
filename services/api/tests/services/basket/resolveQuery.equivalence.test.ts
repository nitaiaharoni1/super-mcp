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

import { resolveQueryItem } from "../../../src/services/basket/resolveQuery.js";

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
});
