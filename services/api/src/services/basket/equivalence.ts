import { normalizeEmbedInput } from "@super-mcp/shared";
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
 * Equivalents for an AUTO-RESOLVED commodity: the SAME generic product carried
 * under a different per-chain product_id (Israeli produce is fragmented into
 * chain-scoped non-GTIN SKUs — 'עגבניות' is one product_id per chain). Grouped
 * ONLY by identical normalized name (+ same class + same unit), a strong
 * fungibility guarantee, so unlike buildEquivalenceSet this does NOT require gate
 * tier 1-2: the fragmented SKUs are tier-null yet interchangeable. A different
 * name (a specific wine, 'עגבניות מרוסקות' crushed tomatoes) is never grouped,
 * which keeps coarse product classes like 'beverage' from substituting one wine
 * for another.
 */
export function buildSameNameEquivalents(
  top: BasketCandidate,
  shortlist: BasketCandidate[],
  maxEquivalents: number,
): BasketCandidate[] {
  if (!top.productClass) return [top];
  const topName = normalizeEmbedInput(top.name);
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.productClass !== top.productClass) continue;
    if ((c.sizeUnit ?? null) !== (top.sizeUnit ?? null)) continue;
    if (normalizeEmbedInput(c.name) !== topName) continue;
    out.push(c);
  }
  return out;
}
