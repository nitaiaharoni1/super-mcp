import { beforeEach, describe, expect, it, vi } from "vitest";
import { HE_RETAIL, heRetailOntologyFixture } from "@super-mcp/shared/test-utils";

const getActiveOntology = vi.fn();
const searchProductsScored = vi.fn();
const rankHitsForIntentMock = vi.fn();
const loadSemanticProfiles = vi.fn();
const searchQueriesForIntentMock = vi.fn((q: string) => [q]);
const mergeSearchHits = vi.fn((batches: unknown[][]) => batches.flat());
const semanticBasketEnabled = vi.fn(() => true);
const semanticBasketShadow = vi.fn(() => false);
const semanticV2PolicyEnabled = vi.fn(() => true);
const semanticV2RecallEnabled = vi.fn(() => true);
const semanticV2Shadow = vi.fn(() => false);

vi.mock("../../../src/services/search/index.js", () => ({
  getActiveOntology: (...args: unknown[]) => getActiveOntology(...args),
  searchProductsScored: (...args: unknown[]) => searchProductsScored(...args),
  rankHitsForIntent: (...args: unknown[]) => rankHitsForIntentMock(...args),
  loadSemanticProfiles: (...args: unknown[]) => loadSemanticProfiles(...args),
  searchQueriesForIntent: (...args: unknown[]) => searchQueriesForIntentMock(...args),
  mergeSearchHits: (...args: unknown[]) => mergeSearchHits(...args),
  activeOntologyVersion: () => "test-ontology",
}));

vi.mock("../../../src/lib/features.js", () => ({
  semanticBasketEnabled: () => semanticBasketEnabled(),
  semanticBasketShadow: () => semanticBasketShadow(),
  semanticV2PolicyEnabled: () => semanticV2PolicyEnabled(),
  semanticV2RecallEnabled: () => semanticV2RecallEnabled(),
  semanticV2Shadow: () => semanticV2Shadow(),
}));

import { resolveQueryItem } from "../../../src/services/basket/resolveQuery.js";
import {
  rankHitsForIntent,
  searchQueriesForIntent,
} from "../../../src/services/search/intentRank.js";
import { makeSearchProductHit } from "../../../test/helpers/searchProductHit.js";

describe("semantic V2 fallback / observability", () => {
  const hit = makeSearchProductHit({
    id: "local",
    name: HE_RETAIL.product.freshChickenThighsPack,
    score: 0.9,
    hasLocalPrice: true,
  });

  beforeEach(() => {
    getActiveOntology.mockReset();
    searchProductsScored.mockReset();
    rankHitsForIntentMock.mockReset();
    loadSemanticProfiles.mockReset();
    searchQueriesForIntentMock.mockClear();
    mergeSearchHits.mockClear();
    semanticBasketEnabled.mockReturnValue(true);
    semanticBasketShadow.mockReturnValue(false);
    semanticV2PolicyEnabled.mockReturnValue(true);
    semanticV2RecallEnabled.mockReturnValue(true);
    semanticV2Shadow.mockReturnValue(false);
    searchProductsScored.mockResolvedValue([hit]);
    searchQueriesForIntentMock.mockImplementation((q: string) => [q]);
    mergeSearchHits.mockImplementation((batches: unknown[][]) => batches.flat());
  });

  it("rankHitsForIntent requires ontology (no fixture default)", () => {
    expect(() =>
      rankHitsForIntent([], HE_RETAIL.query.freshChickenThighs, { preferLocal: true } as never),
    ).toThrow(/requires opts\.ontology/);
  });

  it("searchQueriesForIntent requires ontology (no fixture default)", () => {
    expect(() => searchQueriesForIntent(HE_RETAIL.query.paragiyot, null as never)).toThrow(
      /requires ontology/,
    );
    const qs = searchQueriesForIntent(HE_RETAIL.query.paragiyot, heRetailOntologyFixture());
    expect(qs.length).toBeGreaterThanOrEqual(1);
  });

  it("resolveQuery skips gating when ontology is null and still returns lexical hits", async () => {
    getActiveOntology.mockResolvedValue(null);

    const result = await resolveQueryItem(
      { query: HE_RETAIL.query.paragiyot },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(rankHitsForIntentMock).not.toHaveBeenCalled();
    expect(loadSemanticProfiles).not.toHaveBeenCalled();
    expect(searchQueriesForIntentMock).not.toHaveBeenCalled();
    expect(searchProductsScored).toHaveBeenCalled();
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.name).toBe(hit.name);
    expect(result.productId).toBeNull();
    expect(result.resolutionStatus).toBe("needs_confirmation");
  });

  it("resolveQuery skips policy ranking when semanticV2PolicyEnabled is off", async () => {
    getActiveOntology.mockResolvedValue(heRetailOntologyFixture());
    semanticV2PolicyEnabled.mockReturnValue(false);
    semanticV2Shadow.mockReturnValue(false);

    await resolveQueryItem(
      { query: HE_RETAIL.query.paragiyot },
      { index: 0, amount: null, unit: null },
      undefined,
      false,
    );

    expect(rankHitsForIntentMock).not.toHaveBeenCalled();
    expect(searchQueriesForIntentMock).toHaveBeenCalled();
  });

  it("resolveQuery sets semanticExpand false when V2 recall is off", async () => {
    getActiveOntology.mockResolvedValue(heRetailOntologyFixture());
    semanticV2RecallEnabled.mockReturnValue(false);
    loadSemanticProfiles.mockResolvedValue(new Map([[hit.id, {
      attributes: {},
      concepts: [],
      penalties: [],
      conceptTerms: [],
    }]]));
    rankHitsForIntentMock.mockReturnValue({
      intent: { query: HE_RETAIL.query.paragiyot },
      ranked: [{
        ...hit,
        intentTier: 1,
        intentConflicts: [],
        intentRelaxed: [],
        penaltyScore: 0,
      }],
    });

    await resolveQueryItem(
      { query: HE_RETAIL.query.paragiyot },
      { index: 0, amount: null, unit: null },
      undefined,
      false,
    );

    expect(searchProductsScored).toHaveBeenCalledWith(
      expect.objectContaining({ semanticExpand: false }),
    );
  });

  it("V2 shadow keeps deterministic ranking independent of legacy intent ranker", async () => {
    const ontology = heRetailOntologyFixture();
    getActiveOntology.mockResolvedValue(ontology);
    semanticV2PolicyEnabled.mockReturnValue(true);
    semanticV2Shadow.mockReturnValue(true);
    loadSemanticProfiles.mockResolvedValue(
      new Map([
        [
          hit.id,
          {
            attributes: {},
            concepts: [],
            penalties: [],
            conceptTerms: [],
          },
        ],
      ]),
    );
    const result = await resolveQueryItem(
      { query: HE_RETAIL.query.paragiyot },
      { index: 0, amount: null, unit: null },
      { city: "הרצליה" },
      false,
    );

    expect(rankHitsForIntentMock).not.toHaveBeenCalled();
    expect(result.primaryProductId).toBe(hit.id);
    expect(result.candidates[0]?.productId).toBe(hit.id);
  });
});
