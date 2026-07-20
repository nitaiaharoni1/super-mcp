import { DEFAULT_SEMANTIC_SEARCH_CONFIG, type SemanticSearchConfig } from "@super-mcp/shared";
import { describe, expect, it } from "vitest";
import {
  decideResolution,
  type ResolutionCandidate,
} from "../../../src/services/basket/resolutionDecision.js";

const config: SemanticSearchConfig = {
  ...DEFAULT_SEMANTIC_SEARCH_CONFIG,
  requireDeterministicForAutoResolve: true,
  autoAcceptGap: 0.15,
};

function hit(
  partial: Partial<ResolutionCandidate> & Pick<ResolutionCandidate, "id" | "name">,
): ResolutionCandidate {
  const { evidence: evidenceOverride, ...rest } = partial;
  return {
    matchedVia: "product",
    ...rest,
    evidence: {
      exactName: false,
      exactPhrase: false,
      matchedTokenCount: 0,
      queryTokenCount: 0,
      trigramSimilarity: null,
      aliasMatched: false,
      vectorDistance: null,
      lexicalScore: partial.lexicalScore ?? null,
      ...evidenceOverride,
    },
  };
}

describe("decideResolution", () => {
  it("returns unresolved when there are no candidates", () => {
    const d = decideResolution("", [], config);
    expect(d.status).toBe("unresolved");
    expect(d.autoPrice).toBe(false);
    expect(d.productId).toBeNull();
  });

  it("does not auto-resolve a mid-word prefix continuation (קרח -> קרחון לימון)", () => {
    // "קרח" is a whole-token prefix of "קרחון" but NOT a whole token of the name.
    // A ≤3-token name is only safe when every query token is a whole name token.
    const d = decideResolution(
      "קרח",
      [
        hit({
          id: "popsicle",
          name: "קרחון לימון",
          lexicalScore: 0.95,
          evidence: {
            exactPhrase: false,
            exactName: false,
            queryTokenCount: 1,
            matchedTokenCount: 0,
            lexicalScore: 0.95,
          },
        }),
        hit({
          id: "drybag",
          name: "קרח יבש לויסקי",
          lexicalScore: 0.78,
          evidence: { lexicalScore: 0.78 },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
    expect(d.productId).toBeNull();
  });

  it("does not auto-resolve a wine corkscrew for bare יין", () => {
    const d = decideResolution(
      "יין",
      [
        hit({
          id: "corkscrew",
          name: "חולץ יין",
          lexicalScore: 0.95,
          hasLocalPrice: true,
          evidence: {
            exactPhrase: true,
            exactName: false,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
        hit({
          id: "wine",
          name: "יין קברנה סוביניון 750 מ\"ל",
          lexicalScore: 0.88,
          hasLocalPrice: true,
          evidence: { lexicalScore: 0.88, queryTokenCount: 1, matchedTokenCount: 1 },
        }),
      ],
      config,
    );
    expect(d.autoPrice).toBe(false);
    expect(d.productId).not.toBe("corkscrew");
  });

  it("margin check considers every strong rival in the shortlist, not just [1]", () => {
    // A chosen at [0]; a comparable near-twin C at [2] from a different product
    // line (different name / product id) must trigger confirmation.
    const d = decideResolution(
      "קפה נמס",
      [
        hit({
          id: "a",
          name: "קפה נמס 200 גרם",
          lexicalScore: 0.9,
          evidence: {
            exactPhrase: true,
            queryTokenCount: 2,
            matchedTokenCount: 2,
            lexicalScore: 0.9,
          },
        }),
        hit({
          id: "b",
          name: "קפה שחור טחון",
          lexicalScore: 0.6,
          evidence: { lexicalScore: 0.6 },
        }),
        hit({
          id: "c",
          name: "קפה נמס עדין 200 גרם",
          lexicalScore: 0.9,
          evidence: {
            exactPhrase: true,
            queryTokenCount: 2,
            matchedTokenCount: 2,
            lexicalScore: 0.9,
          },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("does not trip the full-shortlist margin on same-product-line twins (equal SKUs)", () => {
    // Two near-twins share the same normalized name -> same product line ->
    // not a real ambiguity; the top pick still auto-resolves.
    const d = decideResolution(
      "מלפפון",
      [
        hit({
          id: "sku1",
          name: "מלפפון",
          lexicalScore: 0.95,
          evidence: {
            exactName: true,
            exactPhrase: true,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
        hit({
          id: "sku2",
          name: "מלפפון",
          lexicalScore: 0.95,
          evidence: {
            exactName: true,
            exactPhrase: true,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.autoPrice).toBe(true);
    expect(d.productId).toBe("sku1");
  });

  it("does not auto-resolve a penalized sole strong hit", () => {
    const d = decideResolution(
      "קולה",
      [
        hit({
          id: "zero",
          name: "קולה זירו",
          lexicalScore: 0.95,
          intentTier: 2,
          penaltyScore: 1,
          evidence: {
            exactPhrase: true,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("does not auto-resolve RRF-scale 0.016 scores", () => {
    const d = decideResolution(
      "Alpha",
      [
        hit({
          id: "a",
          name: "Alpha",
          score: 0.016,
          lexicalScore: 0.016,
          evidence: { exactPhrase: false, exactName: false, lexicalScore: 0.016 },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
    expect(d.productId).toBeNull();
  });

  it("auto-resolves exact phrase lexical 0.95 with margin", () => {
    const d = decideResolution(
      "מלפפון",
      [
        hit({
          id: "top",
          name: "מלפפון",
          lexicalScore: 0.95,
          evidence: {
            exactPhrase: true,
            exactName: false,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
        hit({
          id: "second",
          name: "מלפפונים במלח",
          lexicalScore: 0.7,
        }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.autoPrice).toBe(true);
    expect(d.productId).toBe("top");
    expect(d.confidence).toBe(0.95);
    expect(d.confidenceLabel).toBe("medium");
    expect(d.lowConfidence).toBe(false);
  });

  it("auto-resolves exact name with high confidence label", () => {
    const d = decideResolution(
      "לימון",
      [
        hit({
          id: "exact",
          name: "לימון",
          lexicalScore: 1,
          evidence: { exactName: true, exactPhrase: true, lexicalScore: 1 },
        }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.confidenceLabel).toBe("high");
  });

  it("does not auto-resolve vector-only recall", () => {
    const d = decideResolution(
      "לימון",
      [
        hit({
          id: "vec",
          name: "Limoncello",
          matchedVia: "vector",
          vectorDistance: 0.12,
          lexicalScore: null,
          score: 0.02,
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("needs confirmation when gate tier is above 2", () => {
    const d = decideResolution(
      "מלפפון",
      [
        hit({
          id: "nearby",
          name: "מלפפון",
          lexicalScore: 0.95,
          intentTier: 3,
          evidence: {
            exactPhrase: true,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("needs confirmation when lexical margin is too small without form disagreement", () => {
    const d = decideResolution(
      "Alpha",
      [
        hit({
          id: "a",
          name: "Alpha",
          lexicalScore: 0.92,
          evidence: {
            exactPhrase: true,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.92,
          },
          profile: { attributes: { form: "fresh" }, concepts: [], penalties: [], conceptTerms: [] },
        }),
        hit({
          id: "b",
          name: "Alpha twin",
          lexicalScore: 0.88,
          evidence: { lexicalScore: 0.88 },
          profile: { attributes: { form: "fresh" }, concepts: [], penalties: [], conceptTerms: [] },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("auto-resolves when next candidate fails form agreement", () => {
    const d = decideResolution(
      "מלפפון",
      [
        hit({
          id: "fresh",
          name: "מלפפון",
          lexicalScore: 0.9,
          evidence: {
            exactPhrase: true,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.9,
          },
          profile: { attributes: { form: "fresh" }, concepts: [], penalties: [], conceptTerms: [] },
        }),
        hit({
          id: "pickled",
          name: "מלפפונים במלח",
          lexicalScore: 0.88,
          evidence: { lexicalScore: 0.88 },
          profile: { attributes: { form: "pickled" }, concepts: [], penalties: [], conceptTerms: [] },
        }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.productId).toBe("fresh");
    expect(d.autoPrice).toBe(true);
  });

  it("ignores fused score when lexical evidence is weak", () => {
    const d = decideResolution(
      "Product",
      [
        hit({
          id: "rrf",
          name: "Product",
          score: 0.55,
          lexicalScore: 0.78,
          evidence: { lexicalScore: 0.78 },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("does not auto-resolve incidental exactPhrase inside a longer host name", () => {
    const d = decideResolution(
      "בצלים",
      [
        hit({
          id: "bread",
          name: "לחם מחמצת עם בצלים",
          lexicalScore: 0.9,
          evidence: {
            exactPhrase: true,
            exactName: false,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.9,
          },
        }),
        hit({
          id: "onion",
          name: "בצל אדום",
          lexicalScore: 0.72,
          evidence: {
            exactPhrase: false,
            queryTokenCount: 1,
            matchedTokenCount: 0,
            lexicalScore: 0.72,
          },
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
    expect(d.productId).toBeNull();
  });

  it("auto-resolves short names via stemmed query tokens (בצלים↔בצל)", () => {
    const d = decideResolution(
      "בצלים",
      [
        hit({
          id: "onion",
          name: "בצל אדום",
          lexicalScore: 0.95,
          intentTier: 1,
          evidence: {
            exactPhrase: false,
            exactName: false,
            queryTokenCount: 1,
            matchedTokenCount: 1,
            lexicalScore: 0.95,
          },
        }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.productId).toBe("onion");
    expect(d.autoPrice).toBe(true);
  });
});

describe("strongLexicalThreshold config", () => {
  it("uses the configured threshold instead of a hardcoded 0.9", () => {
    const candidate = hit({ id: "p1", name: "מלפפון", lexicalScore: 0.85 });
    const strict = decideResolution("מלפפון", [candidate], config);
    expect(strict.status).toBe("needs_confirmation");

    const relaxed = decideResolution("מלפפון", [candidate], {
      ...config,
      strongLexicalThreshold: 0.8,
    });
    expect(relaxed.status).toBe("resolved");
    expect(relaxed.confidenceLabel).toBe("medium");
  });
});

describe("requireDeterministicForAutoResolve", () => {
  it("true (default): fused score alone cannot auto-resolve", () => {
    const d = decideResolution(
      "מלפפון",
      [hit({ id: "p1", name: "מלפפון", lexicalScore: 0.6, score: 0.7 })],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
  });

  it("false: fused score >= autoAcceptScore auto-resolves (rollback lever)", () => {
    const d = decideResolution(
      "מלפפון",
      [hit({ id: "p1", name: "מלפפון", lexicalScore: 0.6, score: 0.7 })],
      { ...config, requireDeterministicForAutoResolve: false },
    );
    expect(d.status).toBe("resolved");
    expect(d.autoPrice).toBe(true);
  });

  it("false: vector-only candidates still never auto-resolve", () => {
    const d = decideResolution(
      "מלפפון",
      [hit({ id: "p1", name: "מלפפון", matchedVia: "vector", vectorDistance: 0.1, score: 0.9 })],
      { ...config, requireDeterministicForAutoResolve: false },
    );
    expect(d.status).not.toBe("resolved");
  });
});

describe("local availability guard (Coke fix)", () => {
  const exactCoke = {
    id: "obscure",
    name: "קוקה קולה 1.5 ליטר",
    lexicalScore: 1,
    hasLocalPrice: false,
    evidence: { exactName: true, lexicalScore: 1, queryTokenCount: 3, matchedTokenCount: 3 },
  } as const;

  it("does not auto-resolve an exact-name product with no local price when a rival is locally available", () => {
    const d = decideResolution(
      "קוקה קולה 1.5 ליטר",
      [
        hit(exactCoke),
        hit({
          id: "mainstream",
          name: "קוקה קולה מוגז 1.5 ל",
          lexicalScore: 0.7,
          hasLocalPrice: true,
        }),
      ],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
    expect(d.autoPrice).toBe(false);
  });

  it("still auto-resolves the exact match when NO candidate has a local price (data sparsity, not a wrong pick)", () => {
    const d = decideResolution(
      "קוקה קולה 1.5 ליטר",
      [
        hit(exactCoke),
        hit({ id: "mainstream", name: "קוקה קולה מוגז 1.5 ל", lexicalScore: 0.7, hasLocalPrice: false }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.productId).toBe("obscure");
  });

  it("auto-resolves normally when the exact match is itself locally available", () => {
    const d = decideResolution(
      "קוקה קולה 1.5 ליטר",
      [
        hit({ ...exactCoke, hasLocalPrice: true }),
        hit({ id: "mainstream", name: "קוקה קולה מוגז 1.5 ל", lexicalScore: 0.7, hasLocalPrice: true }),
      ],
      config,
    );
    expect(d.status).toBe("resolved");
    expect(d.productId).toBe("obscure");
  });
});
