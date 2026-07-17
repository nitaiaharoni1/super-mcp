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

type GoldenCase = {
  query: string;
  amount?: number;
  unit?: string;
  forbiddenNameSubstrings: string[];
  acceptableNameSubstrings: string[];
};

function hit(id: string, name: string, lexicalScore: number, exactPhrase = false): SearchProductHit {
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
    evidence: {
      exactName: false,
      exactPhrase,
      matchedTokenCount: 0,
      queryTokenCount: 0,
      trigramSimilarity: null,
      aliasMatched: false,
      vectorDistance: null,
      lexicalScore,
    },
  };
}

const fixture: { cases: GoldenCase[] } = {
  cases: [
    {
      query: "פרגיות",
      amount: 1.75,
      unit: "kg",
      forbiddenNameSubstrings: ["נקניק", "פסטרמה"],
      acceptableNameSubstrings: ["פרגיות", "ירכיים"],
    },
    {
      query: "מלפפונים",
      forbiddenNameSubstrings: ["במלח", "כבוש", "חמוץ"],
      acceptableNameSubstrings: ["מלפפון"],
    },
    {
      query: "לימונים",
      forbiddenNameSubstrings: ["ליקר"],
      acceptableNameSubstrings: ["לימון"],
    },
    {
      query: "קרח",
      forbiddenNameSubstrings: ["קרחון", "גלידה"],
      acceptableNameSubstrings: ["קרח"],
    },
  ],
};

const candidatesByQuery: Record<string, SearchProductHit[]> = {
  פרגיות: [hit("safe-thighs", "פרגיות עוף", 0.95, true), hit("sausage", "נקניקיות עוף", 0.99)],
  מלפפונים: [hit("fresh-cucumber", "מלפפון טרי", 0.95, true), hit("pickled", "מלפפונים במלח", 0.99)],
  לימונים: [hit("lemon", "לימון טרי", 0.95, true), hit("liqueur", "ליקר לימון", 0.99)],
  קרח: [hit("ice", "קרח", 1, true), hit("dessert", "קרחון לימון", 0.99)],
};

describe("Herzliya BBQ golden safety", () => {
  beforeEach(() => {
    getActiveOntology.mockResolvedValue(heRetailOntologyFixture());
    loadSemanticProfiles.mockResolvedValue(new Map());
    searchProductsScored.mockImplementation(({ q }: { q: string }) => candidatesByQuery[q] ?? []);
  });

  for (const golden of fixture.cases) {
    it(`never auto-selects forbidden ${golden.query} lookalikes`, async () => {
      const result = await resolveQueryItem(
        { query: golden.query, amount: golden.amount, unit: golden.unit },
        { index: 0, amount: golden.amount ?? null, unit: golden.unit ?? null },
        { city: "הרצליה" },
        golden.amount != null,
      );
      const isForbidden = (name: string | null) =>
        Boolean(name && golden.forbiddenNameSubstrings.some((fragment) => name.includes(fragment)));
      const hasAcceptableName = (name: string | null) =>
        Boolean(name && golden.acceptableNameSubstrings.some((fragment) => name.includes(fragment)));

      expect(isForbidden(result.name)).toBe(false);
      expect(hasAcceptableName(result.candidates[0]?.name ?? null)).toBe(true);
      if (result.productId) expect(isForbidden(result.name)).toBe(false);
    });
  }

  it("reapplies current form policy when a stored profile predates migration 009", async () => {
    loadSemanticProfiles.mockResolvedValue(
      new Map(
        candidatesByQuery.מלפפונים.map((candidate) => [
          candidate.id,
          { attributes: {}, concepts: [], penalties: [], conceptTerms: [] },
        ]),
      ),
    );

    const result = await resolveQueryItem(
      { query: "מלפפונים" },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(result.candidates[0]?.name).toContain("מלפפון");
    expect(result.candidates[0]?.name).not.toContain("במלח");
    expect(result.productId).not.toBe("pickled");
  });
});
