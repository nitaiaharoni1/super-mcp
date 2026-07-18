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

  it("marks term-implied attributes as implied/ranking, not explicit/hard", () => {
    // "שניצל" implies species=chicken via a term implication (not an explicit
    // surface for species). It must gate as implied/ranking so it never
    // hard-rejects a conflicting candidate.
    const query = buildQueryProfile("שניצל", ontology);
    const constraints = constraintsFromQueryProfile(query, ontology);
    const species = constraints.find((c) => c.attribute === "species");
    expect(species?.value).toBe("chicken");
    expect(species?.source).toBe("implied");
    expect(species?.strength).toBe("ranking");
    // The explicit surface (cut=schnitzel) stays explicit/hard.
    const cut = constraints.find((c) => c.attribute === "cut");
    expect(cut?.source).toBe("explicit");
    expect(cut?.strength).toBe("hard");
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

  it("rejects candy cola and prefers a regular bottle over zero for bare קולה", () => {
    const q = buildQueryProfile("קולה", ontology);
    const regular = profileFromText("קוקה קולה 1.5 ליטר", ontology);
    const zero = profileFromText("RC קולה זירו פחית 330 מ״ל", ontology);
    const candy = profileFromText("סוכריות גומי בטעם קולה", ontology);
    expect(zero.penalties).toContain("variant:diet");
    expect(candy.attributes.product_class).toBe("candy");

    const constraints = constraintsFromQueryProfile(q, ontology);
    const zeroGate = gateAgainstConstraints(zero, constraints, ontology, {
      queryText: q.normalizedText,
    });
    const regularGate = gateAgainstConstraints(regular, constraints, ontology, {
      queryText: q.normalizedText,
    });
    const candyGate = gateAgainstConstraints(candy, constraints, ontology, {
      queryText: q.normalizedText,
    });
    expect(zeroGate.penaltyScore).toBeGreaterThan(regularGate.penaltyScore);
    expect(zeroGate.tier).toBe(2);
    expect(regularGate.tier).toBe(1);
    expect(candyGate.allowed).toBe(false);

    const ranked = rankDeterministicCandidates(
      q,
      [
        cand("candy", "סוכריות גומי בטעם קולה", candy, {
          lexicalScore: 1,
          exactPhrase: true,
          exactName: false,
        }),
        cand("zero", "RC קולה זירו פחית 330 מ״ל", zero, {
          lexicalScore: 0.99,
          exactPhrase: true,
          exactName: false,
        }),
        cand("regular", "קוקה קולה 1.5 ליטר", regular, {
          lexicalScore: 0.95,
          exactPhrase: true,
          exactName: false,
        }),
      ],
      ontology,
    );

    expect(ranked[0]?.id).toBe("regular");
    expect(ranked.map((candidate) => candidate.id)).not.toContain("candy");
  });

  it("preserves explicit zero intent over a stronger regular cola match", () => {
    const q = buildQueryProfile("קולה זירו", ontology);
    const zero = profileFromText("RC קולה זירו פחית 330 מ״ל", ontology);
    const regular = profileFromText("קוקה קולה בקבוק 1.5 ליטר", ontology);
    const constraints = constraintsFromQueryProfile(q, ontology);
    const zeroGate = gateAgainstConstraints(zero, constraints, ontology, {
      queryText: q.normalizedText,
    });
    expect(zeroGate.penaltyScore).toBe(0);
    expect(zeroGate.tier).toBe(1);

    const ranked = rankDeterministicCandidates(
      q,
      [
        cand("regular", "קוקה קולה בקבוק 1.5 ליטר", regular, {
          lexicalScore: 1,
          exactPhrase: true,
        }),
        cand("zero", "RC קולה זירו פחית 330 מ״ל", zero, {
          lexicalScore: 0.91,
          exactPhrase: true,
        }),
      ],
      ontology,
    );
    expect(ranked[0]?.id).toBe("zero");
  });

  it("rejects ice appliances, whiskey accessories, and popsicles for bare קרח", () => {
    const q = buildQueryProfile("קרח", ontology);
    const candidates = [
      cand("machine", "מכונת קרח ביתית", profileFromText("מכונת קרח ביתית", ontology), {
        lexicalScore: 1,
        exactPhrase: true,
      }),
      cand(
        "whiskey",
        "קוביות קרח רב פעמיות לוויסקי",
        profileFromText("קוביות קרח רב פעמיות לוויסקי", ontology),
        { lexicalScore: 0.99, exactPhrase: true },
      ),
      cand("popsicle", "קרחון קולה", profileFromText("קרחון קולה", ontology), {
        lexicalScore: 0.98,
        exactPhrase: false,
      }),
      cand("bag", "שקית קוביות קרח 2 ק״ג", profileFromText("שקית קוביות קרח 2 ק״ג", ontology), {
        lexicalScore: 0.9,
        exactPhrase: true,
      }),
    ];

    const ranked = rankDeterministicCandidates(q, candidates, ontology);
    expect(ranked.map((candidate) => candidate.id)).toEqual(["bag"]);
  });

  it("keeps a species-conflicting corn schnitzel candidate (implied constraint, no hard reject)", () => {
    const q = buildQueryProfile("שניצל תירס", ontology);
    // A corn schnitzel: shares the schnitzel cut but is not chicken. species
    // arrived only via implication from "שניצל", so it must not hard-reject.
    const corn: SemanticProfile = {
      attributes: { cut: "schnitzel", species: "other", product_class: "produce" },
      concepts: [],
      penalties: [],
      conceptTerms: ["שניצל", "תירס"],
    };
    const chicken = profileFromText("שניצל עוף קפוא", ontology);

    const constraints = constraintsFromQueryProfile(q, ontology);
    const cornGate = gateAgainstConstraints(corn, constraints, ontology, {
      queryText: q.normalizedText,
    });
    expect(cornGate.allowed).toBe(true);

    const ranked = rankDeterministicCandidates(
      q,
      [
        cand("corn", "שניצל תירס קפוא", corn, { lexicalScore: 0.9, exactPhrase: true }),
        cand("chicken", "שניצל עוף קפוא", chicken, { lexicalScore: 0.9, exactPhrase: true }),
      ],
      ontology,
    );
    // Corn must survive the gate (not filtered out) — it stays in the shortlist.
    expect(ranked.some((c) => c.id === "corn")).toBe(true);
  });

  it("demotes a penalized candidate below an unpenalized one within the same tier", () => {
    const q = buildQueryProfile("קולה", ontology);
    const clean = profileFromText("קוקה קולה 1.5 ליטר", ontology);
    const penalized = profileFromText("קוקה קולה 1.5 ליטר", ontology);
    const ranked = rankDeterministicCandidates(
      q,
      [
        // Identical evidence + profile; only the gate.penaltyScore differs.
        {
          ...cand("penalized", "קוקה קולה 1.5 ליטר", penalized, {
            lexicalScore: 0.95,
            exactPhrase: true,
          }),
          gate: { allowed: true, tier: 1, conflicts: [], relaxed: [], penaltyScore: 1 },
        },
        {
          ...cand("clean", "קוקה קולה 1.5 ליטר", clean, {
            lexicalScore: 0.95,
            exactPhrase: true,
          }),
          gate: { allowed: true, tier: 1, conflicts: [], relaxed: [], penaltyScore: 0 },
        },
      ],
      ontology,
    );
    expect(ranked[0]?.id).toBe("clean");
  });
});
