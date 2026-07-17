/** Versioned search / retrieval configuration (loaded from DB). */

export interface SemanticSearchConfig {
  vectorLimit: number;
  vectorDistanceMax: number;
  lexicalLimit: number;
  trigramThreshold: number;
  vectorRrfWeight: number;
  lexicalRrfWeight: number;
  rrfK: number;
  autoAcceptScore: number;
  autoAcceptGap: number;
  nearbyAlternativesEnabled: boolean;
  minProfileCoverage: number;
  firstPassLexicalLimit: number;
  embeddingFallbackLimit: number;
  minSafeResolutionRatio: number;
  substitutionMinConfidence: number;
  requireDeterministicForAutoResolve: boolean;
}

export const DEFAULT_SEMANTIC_SEARCH_CONFIG: SemanticSearchConfig = {
  vectorLimit: 40,
  vectorDistanceMax: 0.45,
  lexicalLimit: 60,
  trigramThreshold: 0.4,
  vectorRrfWeight: 1.0,
  lexicalRrfWeight: 1.0,
  rrfK: 60,
  autoAcceptScore: 0.55,
  autoAcceptGap: 0.15,
  nearbyAlternativesEnabled: true,
  minProfileCoverage: 0.1,
  firstPassLexicalLimit: 20,
  embeddingFallbackLimit: 15,
  minSafeResolutionRatio: 0.7,
  substitutionMinConfidence: 0.25,
  requireDeterministicForAutoResolve: true,
};

export function parseSemanticSearchConfig(raw: unknown): SemanticSearchConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (k: keyof SemanticSearchConfig, fallback: number): number => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const b = (k: keyof SemanticSearchConfig, fallback: boolean): boolean => {
    const v = o[k];
    return typeof v === "boolean" ? v : fallback;
  };
  return {
    vectorLimit: n("vectorLimit", DEFAULT_SEMANTIC_SEARCH_CONFIG.vectorLimit),
    vectorDistanceMax: n("vectorDistanceMax", DEFAULT_SEMANTIC_SEARCH_CONFIG.vectorDistanceMax),
    lexicalLimit: n("lexicalLimit", DEFAULT_SEMANTIC_SEARCH_CONFIG.lexicalLimit),
    trigramThreshold: n("trigramThreshold", DEFAULT_SEMANTIC_SEARCH_CONFIG.trigramThreshold),
    vectorRrfWeight: n("vectorRrfWeight", DEFAULT_SEMANTIC_SEARCH_CONFIG.vectorRrfWeight),
    lexicalRrfWeight: n("lexicalRrfWeight", DEFAULT_SEMANTIC_SEARCH_CONFIG.lexicalRrfWeight),
    rrfK: n("rrfK", DEFAULT_SEMANTIC_SEARCH_CONFIG.rrfK),
    autoAcceptScore: n("autoAcceptScore", DEFAULT_SEMANTIC_SEARCH_CONFIG.autoAcceptScore),
    autoAcceptGap: n("autoAcceptGap", DEFAULT_SEMANTIC_SEARCH_CONFIG.autoAcceptGap),
    nearbyAlternativesEnabled: b(
      "nearbyAlternativesEnabled",
      DEFAULT_SEMANTIC_SEARCH_CONFIG.nearbyAlternativesEnabled,
    ),
    minProfileCoverage: n("minProfileCoverage", DEFAULT_SEMANTIC_SEARCH_CONFIG.minProfileCoverage),
    firstPassLexicalLimit: n("firstPassLexicalLimit", DEFAULT_SEMANTIC_SEARCH_CONFIG.firstPassLexicalLimit),
    embeddingFallbackLimit: n("embeddingFallbackLimit", DEFAULT_SEMANTIC_SEARCH_CONFIG.embeddingFallbackLimit),
    minSafeResolutionRatio: n("minSafeResolutionRatio", DEFAULT_SEMANTIC_SEARCH_CONFIG.minSafeResolutionRatio),
    substitutionMinConfidence: n(
      "substitutionMinConfidence",
      DEFAULT_SEMANTIC_SEARCH_CONFIG.substitutionMinConfidence,
    ),
    requireDeterministicForAutoResolve: b(
      "requireDeterministicForAutoResolve",
      DEFAULT_SEMANTIC_SEARCH_CONFIG.requireDeterministicForAutoResolve,
    ),
  };
}
