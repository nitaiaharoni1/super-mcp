import { compareClassPaths, normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";
import type { BasketCandidate } from "./types.js";

/** Build the LLM taxonomy path from a candidate's class levels. */
function classPathOf(c: BasketCandidate) {
  return { l1: c.classL1 ?? null, l2: c.classL2 ?? null, l3: c.classL3 ?? null };
}

/**
 * The LLM taxonomy places these two in DIFFERENT classes (compared at the deepest
 * level both carry) — never interchangeable. "unknown" (either unclassified) is
 * not a disagreement, so pre-classification behavior is preserved.
 */
function classesConflict(a: BasketCandidate, b: BasketCandidate): boolean {
  return compareClassPaths(classPathOf(a), classPathOf(b)) === "different";
}

// Preserved/prepared forms that are a DIFFERENT product from the fresh staple,
// even though the name shares the query token: pickled/soured/canned, sliced/
// chopped/grated deli cuts, and lime (a different fruit from lemon). Grouping
// "מלפפון" (fresh cucumber) with "מלפפונים בייבי כבושי" (pickled) or "מלפפונים
// פרוסים" (deli-sliced) priced a 33₪ jar/pack as a cucumber; "לימון" pulled in
// "לימון ליים" (lime). These never join a set unless the query asked for that
// form. Kept to unambiguous processing/variety words — drying/roasting/grinding
// are excluded from the list because they're legitimate for staples like coffee
// (קפה נמס מיובש / קפה טחון) and would over-filter.
const PRESERVED_FORM_TOKENS: ReadonlySet<string> = new Set([
  "כבוש",
  "כבושה",
  "כבושי",
  "כבושים",
  "חמוץ",
  "חמוצה",
  "חמוצים",
  "מוחמץ",
  "מוחמצים",
  "משומר",
  "משומרת",
  "משומרים",
  "פרוס",
  "פרוסה",
  "פרוסות",
  "פרוסים",
  "קצוץ",
  "קצוצה",
  "קצוצים",
  "מגורד",
  "מגוררת",
  "מגורר",
  "ממולא",
  "ממולאים",
  "ליים",
]);

/** A candidate whose name carries a preserved-form token the query did not ask for. */
export function hasUnrequestedPreservedForm(queryTokens: Set<string>, candidateName: string): boolean {
  for (const t of tokenizeNormalized(normalizeEmbedInput(candidateName))) {
    if (PRESERVED_FORM_TOKENS.has(t) && !queryTokens.has(t)) return true;
  }
  return false;
}

export interface EquivalenceOptions {
  /** Relative size divergence allowed vs the top pick (0.5 = ±50%). */
  packTolerance: number;
  maxEquivalents: number;
}

/**
 * Candidates a store may price interchangeably for this line. Strictly
 * narrower than the shortlist: gate tier 1-2, identical product class to the
 * top pick, same canonical unit, pack size within tolerance. An unclassified
 * top pick gets NO equivalents — widening without a class signal is exactly
 * the un-gated substitution that was removed for picking wrong products.
 */
export function buildEquivalenceSet(
  top: BasketCandidate,
  shortlist: BasketCandidate[],
  opts: EquivalenceOptions,
): BasketCandidate[] {
  if (!top.productClass) return [top];
  // A preserved form (pickled/sliced/…) the PRIMARY itself doesn't have is a
  // different product — e.g. resolving fresh "מלפפונים" must not price a chain's
  // "מלפפונים בייבי כבושי" as its equivalent. Anchor on the top pick's tokens.
  const topTokens = new Set(tokenizeNormalized(normalizeEmbedInput(top.name)));
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > opts.maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.intentTier == null || c.intentTier < 1 || c.intentTier > 2) continue;
    if (c.productClass !== top.productClass) continue;
    if (classesConflict(top, c)) continue;
    if (hasUnrequestedPreservedForm(topTokens, c.name)) continue;
    if ((c.sizeUnit ?? null) !== (top.sizeUnit ?? null)) continue;
    if (top.sizeQty != null && c.sizeQty != null && top.sizeQty > 0) {
      const div = Math.abs(c.sizeQty - top.sizeQty) / top.sizeQty;
      if (div > opts.packTolerance) continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * Interchangeable SKUs for an AUTO-RESOLVED commodity line, so per-chain pricing
 * can pick the CHEAPEST across chains (the default when the user didn't name a
 * variety/brand). A candidate joins the set when it is AT LEAST AS SPECIFIC as
 * the query — every query token appears in its name — and shares the primary's
 * class, unit, and size (±tolerance). This respects query specificity in both
 * directions:
 *   • 'יין אדום'        → every red wine ('יין אדום …') qualifies → cheapest wins.
 *   • 'יין אדום קברנה'  → only wines whose name also has 'קברנה' → no off-variety.
 *   • 'עגבניות'         → all 'עגבניות …' produce SKUs (fragmented per chain).
 * An unclassified primary gets no set (never widen without a class signal).
 */
export function buildCommodityEquivalents(
  top: BasketCandidate,
  shortlist: BasketCandidate[],
  queryText: string,
  maxEquivalents: number,
  packTolerance = 0.5,
): BasketCandidate[] {
  if (!top.productClass) return [top];
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return [top];
  const queryTokenSet = new Set(queryTokens);
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.productClass !== top.productClass) continue;
    if (classesConflict(top, c)) continue;
    if ((c.sizeUnit ?? null) !== (top.sizeUnit ?? null)) continue;
    if (top.sizeQty != null && c.sizeQty != null && top.sizeQty > 0) {
      if (Math.abs(c.sizeQty - top.sizeQty) / top.sizeQty > packTolerance) continue;
    }
    const nameTokens = new Set(tokenizeNormalized(normalizeEmbedInput(c.name)));
    if (!queryTokens.every((t) => nameTokens.has(t))) continue;
    if (hasUnrequestedPreservedForm(queryTokenSet, c.name)) continue;
    out.push(c);
  }
  return out;
}

export interface AvailabilityEquivalenceOptions {
  maxEquivalents: number;
  packTolerance: number;
  /** Gate penalty at/above which a candidate is an unrequested variant (diet/zero/spicy). */
  penaltyBlock: number;
  /** Penalty score for a candidate id (from the semantic gate). */
  penaltyOf: (productId: string) => number;
}

/**
 * Availability-driven commodity resolution for lines with NO reliable
 * product_class. ~95% of the catalog is unclassified, so a generic commodity
 * query (חומוס, טחינה, מלח גס, אבטיח) is classified "opaque" and forced to a
 * needless confirmation even though every nearby store stocks it. This models
 * the user's intuition — "every store has hummus, just pick one (the cheapest)"
 * — WITHOUT a class signal, by leaning on availability + query specificity:
 *
 * A member must
 *   • be locally available (hasLocalPrice) — availability is the whole point,
 *   • contain every query token as a WHOLE token (specificity; blocks mid-word
 *     host matches like קרח→קרחון and off-intent hits),
 *   • not be a gate-penalized variant (unrequested diet/zero/spicy),
 *   • not be gate-tier 0 (rejected by the semantic gate),
 *   • share the reference member's unit and sit within pack tolerance,
 *   • not disagree on product_class WHEN BOTH have one (class is a positive
 *     signal when present, never required).
 *
 * Returns the ordered set (best-ranked local member first) only when ≥2 qualify
 * — two independent locally-stocked matches is the "widely-carried commodity"
 * signal that separates a real staple from a coincidental token hit. Fewer than
 * two → [] and the caller keeps needs_confirmation.
 */
export function buildAvailabilityEquivalents(
  candidates: BasketCandidate[],
  queryText: string,
  opts: AvailabilityEquivalenceOptions,
): BasketCandidate[] {
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return [];
  const queryTokenSet = new Set(queryTokens);
  // Query-safe, locally-available, non-penalized, non-rejected pool in rank order.
  const pool = candidates.filter((c) => {
    if (!c.hasLocalPrice) return false;
    if (opts.penaltyOf(c.productId) >= opts.penaltyBlock) return false;
    if (c.intentTier === 0) return false;
    if (hasUnrequestedPreservedForm(queryTokenSet, c.name)) return false;
    const nameTokens = new Set(tokenizeNormalized(normalizeEmbedInput(c.name)));
    return queryTokens.every((t) => nameTokens.has(t));
  });
  if (pool.length < 2) return [];
  const primary = pool[0]!;
  const out: BasketCandidate[] = [primary];
  for (const c of pool) {
    if (out.length > opts.maxEquivalents) break;
    if (c.productId === primary.productId) continue;
    if ((c.sizeUnit ?? null) !== (primary.sizeUnit ?? null)) continue;
    if (primary.sizeQty != null && c.sizeQty != null && primary.sizeQty > 0) {
      if (Math.abs(c.sizeQty - primary.sizeQty) / primary.sizeQty > opts.packTolerance) continue;
    }
    if (primary.productClass && c.productClass && primary.productClass !== c.productClass) continue;
    if (classesConflict(primary, c)) continue;
    out.push(c);
  }
  return out.length >= 2 ? out : [];
}
