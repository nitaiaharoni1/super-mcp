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
});
