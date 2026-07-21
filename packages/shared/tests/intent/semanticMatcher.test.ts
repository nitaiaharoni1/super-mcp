import { describe, expect, it } from "vitest";
import {
  HE_RETAIL,
  syntheticMaterialOntology,
  syntheticWidgetOntology,
} from "@super-mcp/shared/test-utils";
import {
  buildOntologySnapshot,
  expandQueryAliases,
  extractConstraints,
  gateAgainstConstraints,
  profileFromText,
} from "../../src/intent/semanticMatcher.js";
import { heRetailOntologyFixture } from "../../test-utils/heRetailOntology.js";

describe("generic semantic matcher (synthetic ontology)", () => {
  const ontology = syntheticWidgetOntology();

  it("extracts exact attributes", () => {
    const c = extractConstraints("red widget", ontology);
    expect(c.some((x) => x.attribute === "color" && x.value === "red")).toBe(true);
  });

  it("hard-rejects same-attribute conflicts without relaxation", () => {
    const ontologyNoRelax = buildOntologySnapshot({
      terms: ontology.terms,
      relaxations: [],
      attributes: ontology.attributes,
    });
    const q = extractConstraints("red widget", ontologyNoRelax);
    const g = gateAgainstConstraints("blue widget", q, ontologyNoRelax, { queryText: "red widget" });
    expect(g.allowed).toBe(false);
    expect(g.conflicts.some((c) => c.startsWith("color:"))).toBe(true);
  });

  it("allows configured relaxation as tier 2", () => {
    const q = extractConstraints("red widget", ontology);
    const g = gateAgainstConstraints("blue widget", q, ontology, { queryText: "red widget" });
    expect(g.allowed).toBe(true);
    expect(g.tier).toBe(2);
  });

  it("applies implications when target attribute unset", () => {
    const profile = profileFromText("xl widget", ontology);
    expect(profile.attributes.size).toBe("large");
    expect(profile.attributes.color).toBe("red");
  });

  it("does not override explicit attribute with implication", () => {
    const profile = profileFromText("xl blue widget", ontology);
    expect(profile.attributes.color).toBe("blue");
  });
});

describe("data-driven policy (temperature/material)", () => {
  const ontology = syntheticMaterialOntology();

  it("hard-rejects temperature conflicts from attribute definitions", () => {
    const q = extractConstraints("hot widget", ontology);
    const g = gateAgainstConstraints("cold widget", q, ontology, { queryText: "hot widget" });
    expect(g.allowed).toBe(false);
    expect(g.conflicts.some((c) => c.startsWith("temperature:"))).toBe(true);
  });

  it("marks implied temperature as implied and allows missing on candidate", () => {
    const q = extractConstraints("steel widget", ontology);
    const temp = q.find((c) => c.attribute === "temperature");
    expect(temp?.value).toBe("cold");
    expect(temp?.source).toBe("implied");
    const g = gateAgainstConstraints("steel widget", q, ontology, { queryText: "steel widget" });
    expect(g.allowed).toBe(true);
  });

  it("never hard-rejects on implied constraint value mismatch", () => {
    const q = extractConstraints("steel widget", ontology);
    const temp = q.find((c) => c.attribute === "temperature");
    expect(temp?.source).toBe("implied");
    // Candidate is hot (conflicts with implied cold) but has steel material.
    const g = gateAgainstConstraints("hot steel widget", q, ontology, {
      queryText: "steel widget",
    });
    expect(g.allowed).toBe(true);
    expect(g.conflicts).toHaveLength(0);
    expect(g.relaxed.some((r) => r.includes("implied_mismatch") || r.includes("temperature"))).toBe(
      true,
    );
  });

  it("soft-mismatches when attribute strength is soft", () => {
    const withSoft = buildOntologySnapshot({
      terms: ontology.terms,
      attributes: [
        {
          attribute: "temperature",
          constraintStrength: "soft",
          missingValueBehavior: "allow",
          enablesNearbyAlternative: false,
          conflictPolicy: "different_value",
        },
        ...ontology.attributes.filter((a) => a.attribute !== "temperature"),
      ],
    });
    const q = extractConstraints("hot widget", withSoft);
    const g = gateAgainstConstraints("cold widget", q, withSoft, { queryText: "hot widget" });
    expect(g.allowed).toBe(true);
    expect(g.tier).toBe(2);
  });

  it("uses missingValueBehavior=relax without attribute-name branches", () => {
    const withRelaxMissing = buildOntologySnapshot({
      terms: [
        {
          kind: "attribute",
          attribute: "seal",
          value: "true",
          term: "sealed",
        },
      ],
      relaxations: [
        { attribute: "seal", fromValue: "true", toValue: "unmarked", label: "seal:unmarked" },
      ],
      attributes: [
        {
          attribute: "seal",
          constraintStrength: "soft",
          missingValueBehavior: "relax",
          enablesNearbyAlternative: false,
          conflictPolicy: "different_value",
        },
      ],
    });
    const q = extractConstraints("sealed widget", withRelaxMissing);
    const g = gateAgainstConstraints("plain widget", q, withRelaxMissing, {
      queryText: "sealed widget",
    });
    expect(g.allowed).toBe(true);
    expect(g.relaxed).toContain("seal:unmarked");
  });
});

describe("Hebrew retail ontology fixture", () => {
  const ontology = heRetailOntologyFixture();

  it("does not discard qualifiers when an alias matches only part of the query", () => {
    const withProductionSelfAlias = buildOntologySnapshot({
      terms: [
        ...ontology.terms,
        {
          kind: "alias",
          attribute: "query",
          value: "חלב",
          term: "חלב",
          matchMode: "alias",
        },
      ],
      relaxations: ontology.relaxations,
      attributes: ontology.attributes,
      searchConfig: ontology.searchConfig,
    });

    expect(expandQueryAliases("חלב תנובה 3%", withProductionSelfAlias)).toEqual([
      "חלב תנובה 3%",
    ]);
  });

  it("detects fresh chicken thighs", () => {
    const p = profileFromText(HE_RETAIL.query.freshChickenThighs, ontology);
    expect(p.attributes.freshness).toBe("fresh");
    expect(p.attributes.species).toBe("chicken");
    expect(p.attributes.cut).toBe("thighs");
  });

  it("rejects frozen when fresh requested", () => {
    const q = extractConstraints(HE_RETAIL.query.freshChickenThighs, ontology);
    const g = gateAgainstConstraints(HE_RETAIL.product.frozenChickenThighs, q, ontology, {
      queryText: HE_RETAIL.query.freshChickenThighs,
    });
    expect(g.allowed).toBe(false);
  });

  it("rejects turkey when chicken thighs requested", () => {
    const q = extractConstraints(HE_RETAIL.query.freshChickenThighs, ontology);
    const g = gateAgainstConstraints(HE_RETAIL.product.turkeyThighsFresh, q, ontology, {
      queryText: HE_RETAIL.query.freshChickenThighs,
    });
    expect(g.allowed).toBe(false);
  });

  it("allows local fresh twin", () => {
    const q = extractConstraints(HE_RETAIL.query.freshChickenThighs, ontology);
    const g = gateAgainstConstraints(HE_RETAIL.product.freshChickenThighsPack, q, ontology, {
      queryText: HE_RETAIL.query.freshChickenThighs,
    });
    expect(g.allowed).toBe(true);
    expect(g.tier).toBe(1);
  });

  it("keeps cut relaxations at tier 2 (not demoted to nearby)", () => {
    const q = extractConstraints("חזה", ontology);
    const g = gateAgainstConstraints("שניצל עוף", q, ontology, { queryText: "חזה" });
    expect(g.allowed).toBe(true);
    expect(g.tier).toBe(2);
    expect(g.relaxed.some((r) => r.includes("breast") || r.includes("schnitzel"))).toBe(true);
  });

  it("rejects unmatched nearby candidates when nearbyAlternativesEnabled is false", () => {
    const noNearby = buildOntologySnapshot({
      terms: ontology.terms,
      relaxations: ontology.relaxations,
      attributes: ontology.attributes,
      searchConfig: { nearbyAlternativesEnabled: false },
    });
    const q = extractConstraints("פרגיות", noNearby);
    const g = gateAgainstConstraints("בננה טרייה", q, noNearby, { queryText: "פרגיות" });
    expect(g.allowed).toBe(false);
    expect(g.conflicts).toContain("concept:no_shared");
  });
});
