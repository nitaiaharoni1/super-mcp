import { normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";
import type { BasketCandidate } from "./types.js";

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
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > opts.maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.intentTier == null || c.intentTier < 1 || c.intentTier > 2) continue;
    if (c.productClass !== top.productClass) continue;
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
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.productClass !== top.productClass) continue;
    if ((c.sizeUnit ?? null) !== (top.sizeUnit ?? null)) continue;
    if (top.sizeQty != null && c.sizeQty != null && top.sizeQty > 0) {
      if (Math.abs(c.sizeQty - top.sizeQty) / top.sizeQty > packTolerance) continue;
    }
    const nameTokens = new Set(tokenizeNormalized(normalizeEmbedInput(c.name)));
    if (!queryTokens.every((t) => nameTokens.has(t))) continue;
    out.push(c);
  }
  return out;
}
