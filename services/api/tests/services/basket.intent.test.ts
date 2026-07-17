import { describe, expect, it } from "vitest";
import { extractProductIntent, gateProductAgainstIntent } from "@super-mcp/shared";
import { HE_RETAIL, heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { rankHitsForIntent } from "../../src/services/search/intentRank.js";
import { herzliyaParagiyotHits } from "../../test/helpers/searchProductHit.js";

/**
 * Regression: optimize_basket("פרגיות", city=הרצליה) must not commit to a
 * globally strong but locally unavailable SKU when a fresh twin is stocked nearby.
 */
describe("Herzliya פרגיות resolution regression", () => {
  const ontology = heRetailOntologyFixture();

  it("ranks local twins above the global-only primary", () => {
    const { ranked } = rankHitsForIntent(herzliyaParagiyotHits(), HE_RETAIL.query.paragiyot, {
      preferLocal: true,
      ontology,
    });
    expect(ranked[0]?.hasLocalPrice).toBe(true);
    expect(ranked[0]?.id).not.toBe("rami-internal");
    expect(["gtin-pack", "stop-market"]).toContain(ranked[0]?.id);
  });

  it("hard-rejects frozen when query implies fresh thighs", () => {
    const intent = extractProductIntent(HE_RETAIL.query.freshThighsShort, ontology);
    expect(gateProductAgainstIntent(HE_RETAIL.product.frozenThighsShort, intent, ontology).allowed).toBe(
      false,
    );
  });
});
