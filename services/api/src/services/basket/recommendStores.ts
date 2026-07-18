import type { BasketStoreResult } from "./types.js";

export interface RecommendationOptions {
  /** Shekels of "cost" per km of distance when comparing equal-coverage stores. */
  distancePenaltyPerKm: number;
}

export interface StoreRecommendations {
  /** Lowest total among compared stores (existing behavior, unchanged). */
  cheapest: BasketStoreResult | null;
  /**
   * Most lines covered; ties broken by total + distance penalty. The answer to
   * "where should I actually go" when no store carries the full basket.
   */
  bestNearby: BasketStoreResult | null;
}

/**
 * Picks two complementary recommendations from the priced store results:
 * `cheapest` (lowest total, the classic answer) and `bestNearby` (maximize
 * priced-line coverage first, break ties by total + a per-km distance penalty).
 * An empty store list yields both null.
 */
export function pickRecommendations(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): StoreRecommendations {
  if (stores.length === 0) return { cheapest: null, bestNearby: null };
  const cheapest = [...stores].sort((a, b) => a.total - b.total)[0]!;
  const bestNearby = [...stores].sort((a, b) => {
    const cov = coveredLines(b) - coveredLines(a);
    if (cov !== 0) return cov;
    return effectiveCost(a, opts) - effectiveCost(b, opts);
  })[0]!;
  return { cheapest, bestNearby };
}

/** Priced-line count: the lines the store actually filled for this basket. */
function coveredLines(s: BasketStoreResult): number {
  return s.lines.length;
}

function effectiveCost(s: BasketStoreResult, opts: RecommendationOptions): number {
  return s.total + (s.distanceKm ?? 0) * opts.distancePenaltyPerKm;
}
