import { heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchProductHit } from "../../../src/services/search/types.js";
import { makeSearchProductHit } from "../../../test/helpers/searchProductHit.js";

const getActiveOntology = vi.fn();
const loadSemanticProfiles = vi.fn();
const searchProductsScored = vi.fn();

vi.mock("../../../src/services/search/index.js", () => ({
  activeOntologyVersion: () => "test-ontology",
  getActiveOntology: (...args: unknown[]) => getActiveOntology(...args),
  loadSemanticProfiles: (...args: unknown[]) => loadSemanticProfiles(...args),
  searchProductsScored: (...args: unknown[]) => searchProductsScored(...args),
}));

vi.mock("../../../src/lib/features.js", () => ({
  semanticBasketEnabled: () => true,
  semanticBasketShadow: () => false,
  semanticV2RecallEnabled: () => true,
  semanticV2Shadow: () => false,
}));

import { resolveItems } from "../../../src/services/basket/resolve.js";

function hitFor(query: string, id: string): SearchProductHit {
  return makeSearchProductHit({
    id,
    name: query,
    score: 0.95,
    lexicalScore: 0.95,
    hasLocalPrice: true,
    hasPrice: true,
    evidence: {
      exactName: true,
      exactPhrase: true,
      matchedTokenCount: 1,
      queryTokenCount: 1,
      trigramSimilarity: 1,
      aliasMatched: false,
      vectorDistance: null,
      lexicalScore: 0.95,
    },
  });
}

describe("basket resolve profile batching", () => {
  beforeEach(() => {
    getActiveOntology.mockReset();
    loadSemanticProfiles.mockReset();
    searchProductsScored.mockReset();
    getActiveOntology.mockResolvedValue(heRetailOntologyFixture());
    loadSemanticProfiles.mockImplementation(async (ids: string[]) => {
      const out = new Map();
      for (const id of ids) {
        out.set(id, {
          attributes: {},
          concepts: [],
          penalties: [],
          conceptTerms: [],
        });
      }
      return out;
    });
  });

  it("calls loadSemanticProfiles once for N query lines", async () => {
    const lines = [
      { query: "מלפפונים", packQty: 1 },
      { query: "לימונים", packQty: 2 },
      { query: "קרח", packQty: 1 },
    ];
    searchProductsScored.mockImplementation(async ({ q }: { q: string }) => {
      const idByQuery: Record<string, string> = {
        מלפפונים: "11111111-1111-4111-8111-111111111111",
        לימונים: "22222222-2222-4222-8222-222222222222",
        קרח: "33333333-3333-4333-8333-333333333333",
      };
      return [hitFor(q, idByQuery[q]!)];
    });

    const resolved = await resolveItems(lines, { city: "הרצליה" });

    expect(searchProductsScored).toHaveBeenCalledTimes(lines.length);
    expect(loadSemanticProfiles).toHaveBeenCalledTimes(1);
    const loadedIds = loadSemanticProfiles.mock.calls[0]?.[0] as string[];
    expect(new Set(loadedIds).size).toBe(lines.length);
    expect(resolved).toHaveLength(lines.length);
    expect(resolved.every((row) => row.resolvedBy === "query" || row.resolvedBy === "unresolved")).toBe(
      true,
    );
  });

  it("skips profile load when there are no query lines", async () => {
    // product_id path hits the DB — mock via unresolved empty product lookup by
    // not mocking @super-mcp/db; use gtin search instead.
    searchProductsScored.mockResolvedValue([
      hitFor("gtin-hit", "44444444-4444-4444-8444-444444444444"),
    ]);

    const resolved = await resolveItems([{ gtin: "7290000000000", packQty: 1 }]);

    expect(loadSemanticProfiles).not.toHaveBeenCalled();
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resolvedBy).toBe("gtin");
  });
});
