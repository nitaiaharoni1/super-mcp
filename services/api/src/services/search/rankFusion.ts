import type { SemanticSearchConfig } from "@super-mcp/shared";
import type { RetrievalCandidate, SearchProductHit } from "./types.js";

/**
 * Weighted reciprocal-rank fusion of independent lexical and vector ranked lists.
 * Rank is 1-based. Stable tie-break by product name.
 */
export function fuseRankedCandidates(
  lexical: SearchProductHit[],
  vector: SearchProductHit[],
  config: SemanticSearchConfig,
): RetrievalCandidate[] {
  const byId = new Map<string, RetrievalCandidate>();

  const ensure = (hit: SearchProductHit): RetrievalCandidate => {
    let c = byId.get(hit.id);
    if (!c) {
      c = {
        ...hit,
        lexicalRank: null,
        vectorRank: null,
        vectorDistance: hit.vectorDistance ?? null,
        fusedScore: 0,
        score: 0,
      };
      byId.set(hit.id, c);
    }
    return c;
  };

  for (let i = 0; i < lexical.length; i++) {
    const hit = lexical[i]!;
    const c = ensure(hit);
    c.lexicalRank = i + 1;
    // Prefer lexical match metadata when present in both lists.
    c.matchedVia = hit.matchedVia;
    c.hasPrice = hit.hasPrice;
    c.hasLocalPrice = hit.hasLocalPrice;
    c.gtin = hit.gtin;
    c.name = hit.name;
    c.brand = hit.brand;
    c.categoryL1 = hit.categoryL1;
    c.categoryL2 = hit.categoryL2;
    c.sizeQty = hit.sizeQty;
    c.sizeUnit = hit.sizeUnit;
    c.lexicalScore = hit.lexicalScore ?? c.lexicalScore ?? null;
    if (hit.evidence) {
      c.evidence = {
        ...hit.evidence,
        ...c.evidence,
        lexicalScore: hit.lexicalScore ?? hit.evidence.lexicalScore,
      };
    }
    c.fusedScore += config.lexicalRrfWeight / (config.rrfK + (i + 1));
  }

  for (let i = 0; i < vector.length; i++) {
    const hit = vector[i]!;
    const c = ensure(hit);
    c.vectorRank = i + 1;
    c.vectorDistance = hit.vectorDistance ?? c.vectorDistance;
    if (c.lexicalRank == null) {
      c.matchedVia = "vector";
      c.hasPrice = hit.hasPrice;
      c.hasLocalPrice = hit.hasLocalPrice;
      c.gtin = hit.gtin;
      c.name = hit.name;
      c.brand = hit.brand;
      c.categoryL1 = hit.categoryL1;
      c.categoryL2 = hit.categoryL2;
      c.sizeQty = hit.sizeQty;
      c.sizeUnit = hit.sizeUnit;
    }
    c.fusedScore += config.vectorRrfWeight / (config.rrfK + (i + 1));
  }

  const fused = [...byId.values()];
  fused.sort((a, b) => {
    if (a.fusedScore !== b.fusedScore) return b.fusedScore - a.fusedScore;
    return a.name.localeCompare(b.name, "en");
  });

  for (const c of fused) {
    c.score = c.fusedScore;
  }
  return fused;
}
