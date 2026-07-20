import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const expectedBbqQueries = [
  "פרגיות",
  "קבבים",
  "אנטרקוט",
  "פיתות",
  "חומוס",
  "טחינה",
  "מלח גס",
  "עגבניות",
  "מלפפונים",
  "פלפלים",
  "בצלים",
  "חסה",
  "לימונים",
  "אבטיח",
  "קולה",
  "יין",
  "קפה טייסטרס צ׳ויס",
  "קרח",
] as const;

const goldenFixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/db/tests/fixtures/herzliya-bbq-golden.json",
);
const goldenFixture = JSON.parse(readFileSync(goldenFixturePath, "utf8")) as {
  cases: GoldenCase[];
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
      forbiddenNameSubstrings: ["ליקר", "עוגת", "עוגה"],
      acceptableNameSubstrings: ["לימון"],
    },
    {
      query: "קרח",
      forbiddenNameSubstrings: ["מכונת", "וויסקי", "קרחון", "גלידה"],
      acceptableNameSubstrings: ["קרח"],
    },
    {
      query: "קולה",
      forbiddenNameSubstrings: ["סוכריות", "גומי", "לקריץ", "דיאט", "זירו", "zero"],
      acceptableNameSubstrings: ["קוקה", "קולה", "cola"],
    },
  ],
};

const candidatesByQuery: Record<string, SearchProductHit[]> = {
  פרגיות: [hit("safe-thighs", "פרגיות עוף", 0.95, true), hit("sausage", "נקניקיות עוף", 0.99)],
  מלפפונים: [hit("fresh-cucumber", "מלפפון טרי", 0.95, true), hit("pickled", "מלפפונים במלח", 0.99)],
  לימונים: [
    hit("cake", "עוגת לימונים 600 גרם", 1, true),
    hit("lemon", "לימון טרי", 0.95, true),
    hit("liqueur", "ליקר לימון", 0.99),
  ],
  קרח: [
    hit("machine", "מכונת קרח ביתית", 1, true),
    hit("whiskey", "קוביות קרח רב פעמיות לוויסקי", 0.99, true),
    hit("dessert", "קרחון לימון", 0.98),
    hit("ice-cream", "גלידת וניל", 0.97),
    hit("ice", "שקית קרח", 0.9, true),
  ],
  קולה: [
    hit("candy", "סוכריות גומי קולה", 1, true),
    hit("licorice", "לקריץ קולה מסוכר במשקל", 0.995, true),
    hit("zero", "RC קולה זירו", 0.99, true),
    hit("regular", "קוקה קולה בקבוק", 0.95, true),
  ],
  יין: [
    hit("cab", "יין אדום קברנה סוביניון", 0.95, true),
    hit("merlot", "יין אדום מרלו", 0.94, true),
    hit("chardonnay", "יין לבן שרדונה", 0.93, true),
  ],
};

describe("Herzliya BBQ golden safety", () => {
  beforeEach(() => {
    getActiveOntology.mockResolvedValue(heRetailOntologyFixture());
    loadSemanticProfiles.mockResolvedValue(new Map());
    searchProductsScored.mockImplementation(({ q }: { q: string }) => candidatesByQuery[q] ?? []);
  });

  it("keeps the canonical Hebrew BBQ acceptance fixture at exactly 18 ordered lines", () => {
    expect(goldenFixture.cases).toHaveLength(18);
    expect(goldenFixture.cases.map((row) => row.query)).toEqual(expectedBbqQueries);
    expect(goldenFixture.cases.find((row) => row.query === "פיתות")).toMatchObject({
      amount: 20,
      unit: "יח",
    });
    expect(goldenFixture.cases.find((row) => row.query === "פרגיות")?.forbiddenNameSubstrings).toEqual(
      expect.arrayContaining(["נקניק", "פסטרמה"]),
    );
    expect(
      goldenFixture.cases.find((row) => row.query === "מלפפונים")?.forbiddenNameSubstrings,
    ).toEqual(expect.arrayContaining(["במלח", "כבוש", "חמוץ"]));
    expect(goldenFixture.cases.find((row) => row.query === "קולה")?.forbiddenNameSubstrings).toEqual(
      expect.arrayContaining(["דיאט", "zero"]),
    );
    expect(goldenFixture.cases.find((row) => row.query === "קרח")?.forbiddenNameSubstrings).toEqual(
      expect.arrayContaining(["קרחון", "גלידה"]),
    );
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

  it("defaults bare cola to regular but asks when lexical evidence remains ambiguous", async () => {
    const result = await resolveQueryItem(
      { query: "קולה" },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(result.candidates[0]?.productId).toBe("regular");
    expect(result.candidates.map((candidate) => candidate.productId)).not.toContain("candy");
    expect(result.candidates[0]?.name).not.toMatch(/לקריץ/);
    expect(result.resolutionStatus).toBe("needs_confirmation");
    expect(result.productId).toBeNull();
  });

  it("לימונים never auto-prices lemon cake or liqueur", async () => {
    const result = await resolveQueryItem(
      { query: "לימונים" },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(result.name).not.toMatch(/עוגת|ליקר/);
    expect(result.candidates[0]?.productId).toBe("lemon");
    expect(result.productId).not.toBe("cake");
    expect(result.productId).not.toBe("liqueur");
  });

  it("קולה amount+unit never auto-prices candy or licorice", async () => {
    const result = await resolveQueryItem(
      { query: "קולה", amount: 2, unit: "יח" },
      { index: 0, amount: 2, unit: "יח" },
      { city: "הרצליה" },
      true,
    );

    expect(result.name).not.toMatch(/סוכריות|לקריץ|גומי/);
    expect(result.candidates[0]?.productId).toBe("regular");
    expect(result.candidates.map((c) => c.productId)).not.toContain("candy");
    expect(result.productId).not.toBe("candy");
    expect(result.productId).not.toBe("licorice");
  });

  it("bare יין auto-resolves a good-enough bottle when multiple wines share the יין token", async () => {
    const result = await resolveQueryItem(
      { query: "יין" },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.productId).toBe("cab");
    expect(result.equivalents?.length).toBeGreaterThanOrEqual(2);
  });

  it("defaults bare ice to consumable bagged ice and excludes non-food lookalikes", async () => {
    const result = await resolveQueryItem(
      { query: "קרח" },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(result.candidates.map((candidate) => candidate.productId)).toEqual(["ice"]);
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.productId).toBe("ice");
  });

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
