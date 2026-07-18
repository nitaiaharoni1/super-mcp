import type { BasketStoreResult } from "./types.js";

export interface RecommendationOptions {
  /** Shekels of "cost" per km of distance when comparing equal-coverage stores. */
  distancePenaltyPerKm: number;
}

export interface StoreRecommendations {
  /**
   * Lowest total among stores covering at least ~80% of the best available
   * coverage (see COVERAGE_FRACTION). Prevents a store that only stocks a
   * sliver of the basket from "winning" cheapest on a tiny total.
   */
  cheapest: BasketStoreResult | null;
  /**
   * Most lines covered; ties broken by total + distance penalty. The answer to
   * "where should I actually go" when no store carries the full basket.
   */
  bestNearby: BasketStoreResult | null;
}

/**
 * Fraction of the best available coverage a store must meet to be eligible
 * for `cheapest`. Keeps "cheapest" from picking a store that only stocks a
 * sliver of the basket just because its (tiny) total is lowest.
 */
const COVERAGE_FRACTION = 0.8;

/**
 * Picks two complementary recommendations from the priced store results:
 * `cheapest` (lowest total among near-best-covering stores) and `bestNearby`
 * (maximize priced-line coverage first, break ties by total + a per-km
 * distance penalty). An empty store list yields both null.
 */
export function pickRecommendations(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): StoreRecommendations {
  if (stores.length === 0) return { cheapest: null, bestNearby: null };

  const maxCov = Math.max(...stores.map(coveredLines));
  const floor = Math.max(1, Math.ceil(maxCov * COVERAGE_FRACTION));
  const eligible = stores.filter((s) => coveredLines(s) >= floor);
  const cheapestPool = eligible.length > 0 ? eligible : stores;
  const cheapest = [...cheapestPool].sort((a, b) => {
    const total = a.total - b.total;
    if (total !== 0) return total;
    return coveredLines(b) - coveredLines(a);
  })[0]!;

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
