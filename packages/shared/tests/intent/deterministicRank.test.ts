import { describe, expect, it } from "vitest";
import { heRetailOntologyFixture } from "../../test-utils/heRetailOntology.js";
import { buildQueryProfile } from "../../src/intent/queryProfile.js";
import {
  constraintsFromQueryProfile,
  rankDeterministicCandidates,
  type DeterministicCandidate,
} from "../../src/intent/deterministicRank.js";
import {
  gateAgainstConstraints,
  profileFromText,
} from "../../src/intent/semanticMatcher.js";
import type { RetrievalEvidence, SemanticProfile } from "../../src/types/semanticTypes.js";

function evidence(
  partial: Partial<RetrievalEvidence> & Pick<RetrievalEvidence, "lexicalScore">,
): RetrievalEvidence {
  return {
    exactName: false,
    exactPhrase: false,
    matchedTokenCount: 0,
    queryTokenCount: 0,
    trigramSimilarity: null,
    aliasMatched: false,
    vectorDistance: null,
    ...partial,
  };
}

function cand(
  id: string,
  name: string,
  profile: SemanticProfile,
  ev: Partial<RetrievalEvidence> & Pick<RetrievalEvidence, "lexicalScore">,
  opts?: { hasLocalPrice?: boolean; hasPrice?: boolean; packExcess?: number },
): Omit<DeterministicCandidate, "gate"> {
  return {
    id,
    name,
    profile,
    evidence: evidence(ev),
    hasLocalPrice: opts?.hasLocalPrice ?? false,
    hasPrice: opts?.hasPrice ?? true,
    packExcess: opts?.packExcess ?? Number.POSITIVE_INFINITY,
  };
}

describe("constraintsFromQueryProfile", () => {
  const ontology = heRetailOntologyFixture();

  it("maps query attributes to hard constraints from ontology definitions", () => {
    const query = buildQueryProfile("מלפפונים", ontology);
    const constraints = constraintsFromQueryProfile(query, ontology);
    const form = constraints.find((c) => c.attribute === "form");
    expect(form?.value).toBe("fresh");
    expect(form?.strength).toBe("hard");
    expect(form?.source).toBe("explicit");
  });
});

describe("rankDeterministicCandidates", () => {
  const ontology = heRetailOntologyFixture();

  it("rejects pickled cucumber for fresh מלפפונים query", () => {
    const q = buildQueryProfile("מלפפונים", ontology);
    const fresh = profileFromText("מלפפון", ontology);
    const pickled = profileFromText("מלפפונים במלח טעם ביתי", ontology);
    expect(pickled.attributes.form).toBe("pickled");

    const constraints = constraintsFromQueryProfile(q, ontology);
    const pickledGate = gateAgainstConstraints(pickled, constraints, ontology, {
      queryText: q.normalizedText,
    });
    expect(pickledGate.allowed).toBe(false);

    const ranked = rankDeterministicCandidates(
      q,
      [
        cand("p", "מלפפונים במלח טעם ביתי", pickled, {
          lexicalScore: 0.78,
          exactName: false,
          exactPhrase: false,
        }),
        cand("f", "מלפפון", fresh, {
          lexicalScore: 0.9,
          exactName: false,
          exactPhrase: true,
        }),
      ],
      ontology,
    );

    expect(ranked[0]?.id).toBe("f");
    expect(ranked.some((c) => c.id === "p")).toBe(false);
  });

  it("does not prefer local sausage over better thigh match when lexical scores favor thighs", () => {
    const q = buildQueryProfile("פרגיות", ontology);
    const thighs = profileFromText("פרגיות עוף טרי", ontology);
    const sausage = profileFromText("נקניק עוף", ontology);
    expect(thighs.attributes.cut).toBe("thighs");
    expect(sausage.attributes.form).toBe("prepared");

    const ranked = rankDeterministicCandidates(
      q,
      [
        cand(
          "sausage",
          "נקניק עוף",
          sausage,
          { lexicalScore: 0.82, exactPhrase: false, exactName: false },
          { hasLocalPrice: true },
        ),
        cand(
          "thighs",
          "פרגיות עוף טרי",
          thighs,
          { lexicalScore: 0.95, exactPhrase: true, exactName: false },
          { hasLocalPrice: false },
        ),
      ],
      ontology,
    );

    expect(ranked[0]?.id).toBe("thighs");
    expect(ranked[0]?.hasLocalPrice).toBe(false);
  });
});
