import { describe, expect, it } from "vitest";
import { syntheticMaterialOntology } from "@super-mcp/shared/test-utils";
import { buildOntologySnapshot } from "../../src/intent/semanticMatcher.js";
import { matchOntologyTerms } from "../../src/intent/tokenMatcher.js";

describe("tokenMatcher", () => {
  const ontology = syntheticMaterialOntology();

  it("does not match a token inside another token", () => {
    const withAnd = buildOntologySnapshot({
      terms: [
        {
          kind: "attribute",
          attribute: "brand",
          value: "acme",
          term: "and",
          matchMode: "token",
        },
      ],
      attributes: ontology.attributes,
    });
    expect(matchOntologyTerms("brandword", withAnd)).toEqual([]);
  });

  it("prefers the longest non-overlapping phrase", () => {
    const matches = matchOntologyTerms("alpha beta product", ontology);
    expect(matches.map((m) => m.surface)).toEqual(["alpha beta"]);
  });

  it("matches a configured multi-token phrase", () => {
    expect(matchOntologyTerms("עוף טוב שניצל", ontology)[0]?.surface).toBe("עוף טוב");
  });
});
