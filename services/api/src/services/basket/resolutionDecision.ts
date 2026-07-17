import {
  isDominantPhraseMatch,
  type RetrievalEvidence,
  type SemanticProfile,
  type SemanticSearchConfig,
} from "@super-mcp/shared";
import type { SearchProductHit } from "../search/types.js";
import type { ResolutionStatus } from "./types.js";

export interface ResolutionDecision {
  status: ResolutionStatus;
  productId: string | null;
  name: string | null;
  confidenceLabel: "high" | "medium" | null;
  /** Lexical score of the chosen candidate (not fused RRF). */
  confidence: number | null;
  lowConfidence: boolean;
  autoPrice: boolean;
}

/** Ranked candidate input for resolution (SearchProductHit-shaped). */
export type ResolutionCandidate = Pick<SearchProductHit, "id" | "name" | "matchedVia" | "vectorDistance"> & {
  /** Fused RRF score — ignored for auto-resolve; kept for compat only. */
  score?: number;
  lexicalScore?: number | null;
  evidence?: RetrievalEvidence;
  /** Compatibility gate tier when available (1 exact, 2 relaxed, 3 nearby, 0 rejected). */
  intentTier?: 1 | 2 | 3 | 0;
  profile?: SemanticProfile;
};

const FORM_CLASS_KEYS = ["form", "product_class"] as const;

function effectiveLexicalScore(candidate: ResolutionCandidate): number | null {
  return candidate.lexicalScore ?? candidate.evidence?.lexicalScore ?? null;
}

function isVectorOnly(candidate: ResolutionCandidate): boolean {
  const lex = effectiveLexicalScore(candidate);
  const ev = candidate.evidence;
  const hasLexicalEvidence =
    (lex != null && lex > 0) ||
    Boolean(ev?.exactName || ev?.exactPhrase || ev?.aliasMatched);
  return (
    !hasLexicalEvidence &&
    (candidate.vectorDistance != null || candidate.matchedVia === "vector")
  );
}

function hasDominantPhrase(candidate: ResolutionCandidate): boolean {
  const ev = candidate.evidence;
  if (!ev) return false;
  return isDominantPhraseMatch(candidate.name, ev);
}

function hasDeterministicEvidence(
  candidate: ResolutionCandidate,
  config: SemanticSearchConfig,
): boolean {
  if (isVectorOnly(candidate)) return false;

  const lex = effectiveLexicalScore(candidate);
  const ev = candidate.evidence;
  // Boundary/contains scores of 0.9 are not enough alone — "לחם…בצלים" for
  // query "בצלים" must not auto-price. Require a name-dominant phrase match.
  const exact =
    Boolean(ev?.exactName) || (Boolean(ev?.exactPhrase) && hasDominantPhrase(candidate));
  const aliasStrong =
    Boolean(ev?.aliasMatched) &&
    lex != null &&
    lex >= 0.9 &&
    isDominantPhraseMatch(candidate.name, {
      exactName: false,
      exactPhrase: true,
      queryTokenCount: Math.max(1, ev?.queryTokenCount ?? 1),
    });
  const strongLexical = lex != null && lex >= 0.9 && hasDominantPhrase(candidate);

  if (config.requireDeterministicForAutoResolve) {
    return exact || strongLexical || aliasStrong;
  }
  return exact || strongLexical || aliasStrong || (lex != null && lex >= 0.9);
}

function gateTierAllowsAutoResolve(candidate: ResolutionCandidate): boolean {
  if (candidate.intentTier == null) return true;
  return candidate.intentTier > 0 && candidate.intentTier <= 2;
}

function profilesDisagreeOnFormClass(
  chosen: ResolutionCandidate,
  other: ResolutionCandidate,
): boolean {
  const a = chosen.profile?.attributes;
  const b = other.profile?.attributes;
  if (!a || !b) return false;
  for (const key of FORM_CLASS_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (av != null && bv != null && av !== bv) return true;
  }
  return false;
}

function hasLexicalMargin(
  chosen: ResolutionCandidate,
  next: ResolutionCandidate | undefined,
  autoAcceptGap: number,
): boolean {
  if (!next) return true;
  const chosenLex = effectiveLexicalScore(chosen);
  const nextLex = effectiveLexicalScore(next);
  if (chosenLex == null || nextLex == null) {
    return profilesDisagreeOnFormClass(chosen, next);
  }
  if (nextLex <= chosenLex - autoAcceptGap) return true;
  return profilesDisagreeOnFormClass(chosen, next);
}

function confidenceLabelFor(
  candidate: ResolutionCandidate,
): "high" | "medium" | null {
  if (candidate.evidence?.exactName) return "high";
  if (candidate.evidence?.exactPhrase && hasDominantPhrase(candidate)) return "medium";
  const lex = effectiveLexicalScore(candidate);
  if (lex != null && lex >= 0.9 && hasDominantPhrase(candidate)) return "medium";
  return null;
}

function needsConfirmationDecision(): ResolutionDecision {
  return {
    status: "needs_confirmation",
    productId: null,
    name: null,
    confidenceLabel: null,
    confidence: null,
    lowConfidence: true,
    autoPrice: false,
  };
}

function unresolvedDecision(): ResolutionDecision {
  return {
    status: "unresolved",
    productId: null,
    name: null,
    confidenceLabel: null,
    confidence: null,
    lowConfidence: true,
    autoPrice: false,
  };
}

/**
 * Decide whether a ranked shortlist may auto-resolve for pricing.
 * Uses lexical evidence and compatibility tier — never fused RRF scores or vector alone.
 */
export function decideResolution(
  candidates: ResolutionCandidate[],
  config: SemanticSearchConfig,
): ResolutionDecision {
  if (candidates.length === 0) {
    return unresolvedDecision();
  }

  const chosen = candidates[0]!;
  const next = candidates.length > 1 ? candidates[1] : undefined;

  const canAutoResolve =
    hasDeterministicEvidence(chosen, config) &&
    gateTierAllowsAutoResolve(chosen) &&
    hasLexicalMargin(chosen, next, config.autoAcceptGap);

  if (!canAutoResolve) {
    return needsConfirmationDecision();
  }

  return {
    status: "resolved",
    productId: chosen.id,
    name: chosen.name,
    confidenceLabel: confidenceLabelFor(chosen),
    confidence: effectiveLexicalScore(chosen),
    lowConfidence: false,
    autoPrice: true,
  };
}
