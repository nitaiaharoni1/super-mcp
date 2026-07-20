import {
  compareClassPaths,
  isDominantPhraseMatch,
  normalizeEmbedInput,
  queryTokensSatisfied,
  tokenizeNormalized,
  type ClassPath,
  type RetrievalEvidence,
  type SemanticProfile,
  type SemanticSearchConfig,
} from "@super-mcp/shared";
import type { SearchProductHit } from "../search/types.js";
import { queryHeadAnchored } from "./equivalence.js";
import type { ResolutionStatus } from "./types.js";
import { isVectorOnly } from "./vectorOnly.js";

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
  /** Fused RRF score — ignored for auto-resolve gates (ranking only). */
  score?: number;
  lexicalScore?: number | null;
  evidence?: RetrievalEvidence;
  /** Compatibility gate tier when available (1 exact, 2 relaxed, 3 nearby, 0 rejected). */
  intentTier?: 1 | 2 | 3 | 0;
  /** Semantic gate penalty weight; a penalized candidate cannot auto-resolve. */
  penaltyScore?: number;
  /** True when priced in the requested location scope (city/near/store). */
  hasLocalPrice?: boolean;
  /** Offline LLM taxonomy path (migration 017), for hierarchical distinguishability. */
  classPath?: ClassPath;
  /** Labeled variant (migration 018): a rival of a different variant is distinguishable. */
  variant?: string | null;
  profile?: SemanticProfile;
};

const FORM_CLASS_KEYS = ["form", "product_class"] as const;

function effectiveLexicalScore(candidate: ResolutionCandidate): number | null {
  return candidate.lexicalScore ?? candidate.evidence?.lexicalScore ?? null;
}

function hasDominantPhrase(candidate: ResolutionCandidate): boolean {
  const ev = candidate.evidence;
  if (!ev) return false;
  return isDominantPhraseMatch(candidate.name, ev);
}

/**
 * Prefer evidence-based dominance; else certify a short (≤3-token) product name
 * only when every query token is a *whole* token of the name. A mid-word
 * continuation must never certify: "קרח" must not make "קרחון לימון" safe.
 * Utensil/opener leaders ("חולץ יין" for query "יין") are never safe to auto-price.
 */
function nameIsQuerySafe(candidate: ResolutionCandidate, queryText: string): boolean {
  if (!queryHeadAnchored(queryText, candidate.name)) return false;
  if (hasDominantPhrase(candidate)) return true;
  const nameTokens = tokenizeNormalized(normalizeEmbedInput(candidate.name));
  // Blocks incidental host names like "לחם מחמצת עם בצלים" (4+ tokens).
  if (nameTokens.length === 0 || nameTokens.length > 3) return false;
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  // Morphology-tolerant: בצלים↔בצל, פיתות↔פיתה (exact token includes was too strict).
  return queryTokens.length > 0 && queryTokensSatisfied(queryTokens, candidate.name);
}
function hasDeterministicEvidence(
  candidate: ResolutionCandidate,
  config: SemanticSearchConfig,
  queryText: string,
): boolean {
  if (isVectorOnly(candidate)) return false;

  const lex = effectiveLexicalScore(candidate);
  const ev = candidate.evidence;
  const threshold = config.strongLexicalThreshold ?? 0.9;
  // Boundary/contains scores are not enough alone — "לחם…בצלים" for query
  // "בצלים" must not auto-price. Require a name-safe / dominant match.
  const exact =
    Boolean(ev?.exactName) || (Boolean(ev?.exactPhrase) && nameIsQuerySafe(candidate, queryText));
  const aliasStrong =
    Boolean(ev?.aliasMatched) &&
    lex != null &&
    lex >= threshold &&
    nameIsQuerySafe(candidate, queryText);
  const strongLexical =
    lex != null && lex >= threshold && nameIsQuerySafe(candidate, queryText);

  if (config.requireDeterministicForAutoResolve) {
    return exact || strongLexical || aliasStrong;
  }
  // Rollback lever: allow fused score auto-accept when deterministic-first is off.
  const fused = candidate.score ?? 0;
  if (fused >= config.autoAcceptScore) return true;
  return exact || strongLexical || aliasStrong;
}

function gateTierAllowsAutoResolve(
  candidate: ResolutionCandidate,
  config: SemanticSearchConfig,
): boolean {
  // A candidate the semantic gate penalized (e.g. an unrequested diet/spicy
  // variant) is never confident enough to auto-price.
  const penaltyBlock = config.penaltyBlockThreshold ?? 1;
  if ((candidate.penaltyScore ?? 0) >= penaltyBlock) return false;
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

/**
 * Two candidates the LLM taxonomy places in different classes are distinguishable,
 * not confusable — the spread/dry-grains/roasted-snack rivals of "חומוס" stop
 * blocking the lexical margin, so the line collapses to its same-class SKUs and
 * auto-resolves. "unknown" (either unclassified) never distinguishes → today's
 * behavior. Compared at the DEEPEST level both carry.
 */
function classesDistinguish(a: ResolutionCandidate, b: ResolutionCandidate): boolean {
  // A labeled variant mismatch (regular vs baby_mini/diet_zero/cherry_grape) makes
  // the rival a DIFFERENT product, not a confusable near-twin — so a generic line
  // ("מלפפונים") isn't blocked from auto-resolving by "מלפפונים בייבי".
  if (a.variant && b.variant && a.variant !== b.variant) return true;
  if (!a.classPath || !b.classPath) return false;
  return compareClassPaths(a.classPath, b.classPath) === "different";
}

/** Two candidates are the same product line if they share a product id or a normalized name. */
function sameProductLine(a: ResolutionCandidate, b: ResolutionCandidate): boolean {
  if (a.id === b.id) return true;
  return normalizeEmbedInput(a.name) === normalizeEmbedInput(b.name);
}

/**
 * Auto-resolve needs a lexical margin over EVERY rival in the shortlist, not
 * just [1]: a comparable near-twin from a different product line at any position
 * is a real ambiguity. Rivals that disagree on form/product-class are
 * distinguishable (not confusable) and don't block; equal SKUs of the same line
 * are pricing detail, not ambiguity.
 */
function hasLexicalMargin(
  chosen: ResolutionCandidate,
  rivals: ResolutionCandidate[],
  autoAcceptGap: number,
): boolean {
  const chosenLex = effectiveLexicalScore(chosen);
  for (const rival of rivals) {
    if (sameProductLine(chosen, rival)) continue;
    if (profilesDisagreeOnFormClass(chosen, rival)) continue;
    if (classesDistinguish(chosen, rival)) continue;
    const rivalLex = effectiveLexicalScore(rival);
    if (chosenLex == null || rivalLex == null) {
      // Missing scores: only a form/class disagreement (handled above) can
      // clear the ambiguity; otherwise treat as a confusable near-twin.
      return false;
    }
    if (rivalLex > chosenLex - autoAcceptGap) return false;
  }
  return true;
}

function confidenceLabelFor(
  candidate: ResolutionCandidate,
  queryText: string,
  config?: SemanticSearchConfig,
): "high" | "medium" | null {
  if (candidate.evidence?.exactName) return "high";
  if (candidate.evidence?.exactPhrase && nameIsQuerySafe(candidate, queryText)) return "medium";
  const lex = effectiveLexicalScore(candidate);
  const threshold = config?.strongLexicalThreshold ?? 0.9;
  if (lex != null && lex >= threshold && nameIsQuerySafe(candidate, queryText)) return "medium";
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
  queryText: string,
  candidates: ResolutionCandidate[],
  config: SemanticSearchConfig,
): ResolutionDecision {
  if (candidates.length === 0) {
    return unresolvedDecision();
  }

  const chosen = candidates[0]!;
  const rivals = candidates.slice(1);

  // Don't auto-price a product that nobody in the requested location carries when
  // a shortlist alternative IS locally available — even on an exact name match.
  // (The query "קוקה קולה 1.5 ליטר" exact-matched a single-chain SKU with zero
  // local stores while 6-chain cokes sat one rank lower.) When NO candidate has a
  // local price it's data sparsity, not a wrong pick, so we don't block there.
  const prefersUnavailableProduct =
    chosen.hasLocalPrice === false && rivals.some((c) => c.hasLocalPrice === true);

  const canAutoResolve =
    hasDeterministicEvidence(chosen, config, queryText) &&
    gateTierAllowsAutoResolve(chosen, config) &&
    hasLexicalMargin(chosen, rivals, config.autoAcceptGap) &&
    !prefersUnavailableProduct;

  if (!canAutoResolve) {
    return needsConfirmationDecision();
  }

  return {
    status: "resolved",
    productId: chosen.id,
    name: chosen.name,
    confidenceLabel: confidenceLabelFor(chosen, queryText, config),
    confidence: effectiveLexicalScore(chosen),
    lowConfidence: false,
    autoPrice: true,
  };
}
