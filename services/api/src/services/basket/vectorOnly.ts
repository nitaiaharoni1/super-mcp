/**
 * Shared "vector-only" predicate for resolution + ranking. A hit with no lexical
 * evidence (no lexicalScore > 0 and no exact/phrase/alias name evidence) that was
 * recalled only via the vector index must never auto-price.
 */
export interface VectorOnlyCandidate {
  lexicalScore?: number | null;
  evidence?: {
    lexicalScore?: number | null;
    exactName?: boolean;
    exactPhrase?: boolean;
    aliasMatched?: boolean;
  } | null;
  vectorDistance?: number | null;
  matchedVia?: string | null;
}

export function isVectorOnly(candidate: VectorOnlyCandidate): boolean {
  const lex = candidate.lexicalScore ?? candidate.evidence?.lexicalScore ?? null;
  const ev = candidate.evidence;
  const hasLexicalEvidence =
    (lex != null && lex > 0) ||
    Boolean(ev?.exactName || ev?.exactPhrase || ev?.aliasMatched);
  return (
    !hasLexicalEvidence &&
    (candidate.vectorDistance != null || candidate.matchedVia === "vector")
  );
}
