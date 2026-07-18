import { describe, expect, it } from "vitest";
import { HE_RETAIL, heRetailOntologyFixture, syntheticMaterialOntology } from "@super-mcp/shared/test-utils";
import { rankHitsForIntent } from "../../../src/services/search/intentRank.js";
import { freshThighRankingHits } from "../../../test/helpers/searchProductHit.js";
import type { SearchProductHit } from "../../../src/services/search/types.js";

function hit(
  partial: Pick<SearchProductHit, "id" | "name" | "score"> & Partial<SearchProductHit>,
): SearchProductHit {
  return {
    matchedVia: "name",
    sizeQty: null,
    sizeUnit: null,
    hasPrice: true,
    hasLocalPrice: true,
    ...partial,
  };
}

describe("rankHitsForIntent", () => {
  it("prefers a locally stocked fresh twin over a global-only name match", () => {
    const { ranked } = rankHitsForIntent(freshThighRankingHits(), HE_RETAIL.query.freshChickenThighs, {
      preferLocal: true,
      ontology: heRetailOntologyFixture(),
    });
    expect(ranked.map((h) => h.id)).toEqual(["local"]);
    expect(ranked[0]?.intentTier).toBe(1);
  });

  it("throws when ontology is omitted", () => {
    expect(() =>
      rankHitsForIntent(freshThighRankingHits(), HE_RETAIL.query.freshChickenThighs, {
        preferLocal: true,
      } as never),
    ).toThrow(/requires opts\.ontology/);
  });

  it("hard-rejects temperature conflicts using synthetic attribute policy", () => {
    const ontology = syntheticMaterialOntology();
    const { ranked } = rankHitsForIntent(
      [hit({ id: "cold", name: "cold widget", score: 0.9 })],
      "hot widget",
      { ontology, preferLocal: false },
    );
    expect(ranked).toHaveLength(0);
  });

  it("soft-mismatches missing soft attributes as tier 2", () => {
    const ontology = syntheticMaterialOntology();
    const { ranked } = rankHitsForIntent(
      [hit({ id: "plain", name: "plain widget", score: 0.9 })],
      "and widget",
      { ontology, preferLocal: false },
    );
    expect(ranked[0]?.intentTier).toBe(2);
  });

  it("uses complete stored profiles without rebuilding conceptTerms from name split", () => {
    const ontology = syntheticMaterialOntology();
    const profiles = new Map([
      [
        "stored",
        {
          attributes: { temperature: "hot", material: "steel" },
          concepts: ["widget"],
          penalties: [] as string[],
          conceptTerms: ["custom-term"],
        },
      ],
    ]);
    const { ranked } = rankHitsForIntent(
      [hit({ id: "stored", name: "unrelated name tokens here", score: 0.8 })],
      "hot steel widget",
      { ontology, preferLocal: false, profiles },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.intentTier).toBe(1);
  });

  it("rejects when product name hard-conflicts even if stored profile looks clean", () => {
    const ontology = syntheticMaterialOntology();
    const profiles = new Map([
      [
        "stale",
        {
          attributes: { temperature: "hot", material: "steel" },
          concepts: ["widget"],
          penalties: [] as string[],
          conceptTerms: ["widget"],
        },
      ],
    ]);
    const { ranked } = rankHitsForIntent(
      [hit({ id: "stale", name: "cold steel widget", score: 0.95 })],
      "hot steel widget",
      { ontology, preferLocal: false, profiles },
    );
    expect(ranked).toHaveLength(0);
  });

  it("ranks production-like cola retrieval without candy leakage", () => {
    const ontology = heRetailOntologyFixture();
    const { ranked } = rankHitsForIntent(
      [
        hit({ id: "rc-candy", name: "סוכריות גומי RC קולה", score: 1 }),
        hit({ id: "rc-zero", name: "RC קולה זירו פחית 330 מ״ל", score: 0.99 }),
        hit({ id: "coca-cola", name: "קוקה קולה בקבוק 1.5 ליטר", score: 0.91 }),
      ],
      "קולה",
      { ontology, preferLocal: false },
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(["coca-cola", "rc-zero"]);
    expect(ranked[0]?.penaltyScore).toBe(0);
    expect(ranked[1]?.penaltyScore).toBeGreaterThan(0);
  });

  it("preserves explicit zero cola intent at retrieval ranking level", () => {
    const ontology = heRetailOntologyFixture();
    const { ranked } = rankHitsForIntent(
      [
        hit({ id: "regular", name: "קוקה קולה בקבוק 1.5 ליטר", score: 1 }),
        hit({ id: "zero", name: "RC קולה זירו פחית 330 מ״ל", score: 0.9 }),
      ],
      "קולה זירו",
      { ontology, preferLocal: false },
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(["zero", "regular"]);
    expect(ranked[0]?.intentTier).toBe(1);
    expect(ranked[1]?.intentTier).toBe(2);
  });

  it("ranks only consumable bagged ice from adversarial retrieval", () => {
    const ontology = heRetailOntologyFixture();
    const { ranked } = rankHitsForIntent(
      [
        hit({ id: "machine", name: "מכונת קרח ביתית", score: 1 }),
        hit({ id: "whiskey", name: "קוביות קרח רב פעמיות לוויסקי", score: 0.99 }),
        hit({ id: "popsicle", name: "קרחון קולה", score: 0.98 }),
        hit({ id: "ice-cream", name: "גלידת וניל", score: 0.97 }),
        hit({ id: "bag", name: "שקית קוביות קרח 2 ק״ג", score: 0.9 }),
      ],
      "קרח",
      { ontology, preferLocal: false },
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(["bag"]);
  });
});
