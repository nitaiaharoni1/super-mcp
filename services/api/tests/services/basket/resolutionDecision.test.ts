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
    const d = decideResolution([], config);
    expect(d.status).toBe("unresolved");
    expect(d.autoPrice).toBe(false);
    expect(d.productId).toBeNull();
  });

  it("does not auto-resolve RRF-scale 0.016 scores", () => {
    const d = decideResolution(
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
});

describe("strongLexicalThreshold config", () => {
  it("uses the configured threshold instead of a hardcoded 0.9", () => {
    const candidate = hit({ id: "p1", name: "מלפפון", lexicalScore: 0.85 });
    const strict = decideResolution([candidate], config);
    expect(strict.status).toBe("needs_confirmation");

    const relaxed = decideResolution([candidate], { ...config, strongLexicalThreshold: 0.8 });
    expect(relaxed.status).toBe("resolved");
    expect(relaxed.confidenceLabel).toBe("medium");
  });
});

describe("requireDeterministicForAutoResolve", () => {
  it("true (default): fused score alone cannot auto-resolve", () => {
    const d = decideResolution(
      [hit({ id: "p1", name: "מלפפון", lexicalScore: 0.6, score: 0.7 })],
      config,
    );
    expect(d.status).toBe("needs_confirmation");
  });

  it("false: fused score >= autoAcceptScore auto-resolves (rollback lever)", () => {
    const d = decideResolution(
      [hit({ id: "p1", name: "מלפפון", lexicalScore: 0.6, score: 0.7 })],
      { ...config, requireDeterministicForAutoResolve: false },
    );
    expect(d.status).toBe("resolved");
    expect(d.autoPrice).toBe(true);
  });

  it("false: vector-only candidates still never auto-resolve", () => {
    const d = decideResolution(
      [hit({ id: "p1", name: "מלפפון", matchedVia: "vector", vectorDistance: 0.1, score: 0.9 })],
      { ...config, requireDeterministicForAutoResolve: false },
    );
    expect(d.status).not.toBe("resolved");
  });
});
