import type { SearchProductHit } from "../search/types.js";
import { AUTO_ACCEPT_GAP, AUTO_ACCEPT_SCORE } from "./constants.js";
import type { ProductClassInfo } from "./productClasses.js";
import type { BasketCandidate } from "./types.js";

export function hitToCandidate(
  hit: SearchProductHit & { intentTier?: 1 | 2 | 3 | 0 },
  productClass: string | null = null,
  classInfo?: ProductClassInfo | null,
): BasketCandidate {
  return {
    productId: hit.id,
    name: hit.name,
    score: hit.score,
    matchedVia: hit.matchedVia,
    sizeQty: hit.sizeQty,
    sizeUnit: hit.sizeUnit,
    hasPrice: hit.hasPrice,
    hasLocalPrice: hit.hasLocalPrice ?? hit.hasPrice,
    // Prefer the LLM taxonomy L1 as the coarse product_class when the ontology
    // didn't derive one (keeps flat-class consumers working); classL* carry the
    // full path for hierarchical comparison.
    productClass: productClass ?? classInfo?.l1 ?? null,
    classL1: classInfo?.l1 ?? null,
    classL2: classInfo?.l2 ?? null,
    classL3: classInfo?.l3 ?? null,
    variant: classInfo?.variant ?? null,
    brandExtracted: classInfo?.brand ?? null,
    intentTier: hit.intentTier,
  };
}

/**
 * Legacy pick helper for pack-peer narrowing. Do not use fused `score` or
 * `autoAcceptScore` for pricing decisions — `decideResolution` is the authority
 * for `autoPrice` once wired in resolveQuery (Task 6).
 */
export function pickFromCandidates(
  hits: SearchProductHit[],
  opts?: {
    compareSizedPeersOnly?: boolean;
    autoAcceptScore?: number;
    autoAcceptGap?: number;
  },
): {
  chosen: SearchProductHit | null;
  /** True when the match is ambiguous or below the strong threshold — still may auto-price. */
  lowConfidence: boolean;
  /** False only for weak matches that must not enter store totals. */
  autoPrice: boolean;
  confidence: number | null;
} {
  if (hits.length === 0) {
    return { chosen: null, lowConfidence: true, autoPrice: false, confidence: null };
  }
  const autoAcceptScore = opts?.autoAcceptScore ?? AUTO_ACCEPT_SCORE;
  const autoAcceptGap = opts?.autoAcceptGap ?? AUTO_ACCEPT_GAP;
  const top = hits[0]!;
  // When amount+unit re-ranked sized SKUs above generic name ties, ignore unsized rivals for the gap.
  const peers =
    opts?.compareSizedPeersOnly && top.sizeQty != null && top.sizeUnit != null
      ? hits.filter((h) => h.sizeQty != null && h.sizeUnit != null)
      : hits;
  const second = peers.length > 1 ? peers[1] : undefined;
  const gap = second ? top.score - second.score : 1;
  const ambiguous = Boolean(second && gap < autoAcceptGap);
  // Price strong hits even when near-tied (common for Israeli catalog duplicates); flag lowConfidence.
  const autoPrice =
    top.score >= autoAcceptScore || (top.score >= 0.4 && gap >= autoAcceptGap);
  return {
    chosen: top,
    lowConfidence: ambiguous || top.score < autoAcceptScore,
    autoPrice,
    confidence: top.score,
  };
}
