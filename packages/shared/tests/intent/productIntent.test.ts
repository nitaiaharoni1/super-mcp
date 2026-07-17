import { describe, expect, it } from "vitest";
import { HE_RETAIL } from "@super-mcp/shared/test-utils";
import { heRetailOntologyFixture } from "../../test-utils/heRetailOntology.js";
import { extractProductIntent, gateProductAgainstIntent } from "../../src/intent/productIntent.js";

describe("extractProductIntent", () => {
  const ontology = heRetailOntologyFixture();

  it("detects fresh chicken thighs", () => {
    const intent = extractProductIntent(HE_RETAIL.query.freshChickenThighs, ontology);
    expect(intent.freshness).toBe("fresh");
    expect(intent.species).toBe("chicken");
    expect(intent.cut).toBe("thighs");
  });

  it("detects frozen conflict surface", () => {
    const intent = extractProductIntent(HE_RETAIL.query.frozenThighsShort, ontology);
    expect(intent.freshness).toBe("frozen");
    expect(intent.cut).toBe("thighs");
  });

  it("requires ontology", () => {
    expect(() =>
      extractProductIntent(HE_RETAIL.query.freshChickenThighs, null as never),
    ).toThrow(/requires ontology/);
  });
});

describe("gateProductAgainstIntent", () => {
  const ontology = heRetailOntologyFixture();
  const freshThighs = extractProductIntent(HE_RETAIL.query.freshChickenThighs, ontology);

  it("allows local fresh twin", () => {
    const g = gateProductAgainstIntent(HE_RETAIL.product.freshChickenThighsPack, freshThighs, ontology);
    expect(g.allowed).toBe(true);
    expect(g.tier).toBe(1);
  });

  it("rejects frozen when fresh requested", () => {
    const g = gateProductAgainstIntent(HE_RETAIL.product.frozenChickenThighs, freshThighs, ontology);
    expect(g.allowed).toBe(false);
    expect(g.conflicts.some((c) => c.startsWith("freshness:"))).toBe(true);
  });

  it("rejects turkey when chicken thighs requested", () => {
    const g = gateProductAgainstIntent(HE_RETAIL.product.turkeyThighsFresh, freshThighs, ontology);
    expect(g.allowed).toBe(false);
  });
});
