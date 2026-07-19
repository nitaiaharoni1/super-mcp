import type { BasketStoreResult } from "./types.js";

export interface RecommendationOptions {
  /** Shekels of "cost" per km of distance when comparing equal-coverage stores. */
  distancePenaltyPerKm: number;
  /**
   * When false, distance is ignored in ranking (e.g. city_centroid-only coords).
   * Defaults to true for backward compatibility with pure unit tests.
   */
  distanceReliable?: boolean;
}

export interface StoreRecommendations {
  /**
   * Lowest total among stores covering at least ~80% of the best available
   * coverage (see COVERAGE_FRACTION). Prevents a store that only stocks a
   * sliver of the basket from "winning" cheapest on a tiny total.
   */
  cheapest: BasketStoreResult | null;
  /**
   * Within a 1-line coverage band of the max, prefer lower total (+ distance
   * when reliable). Primary "where should I actually go" pick; matches bestInStore.
   */
  bestNearby: BasketStoreResult | null;
  /** Same pick as bestNearby — physical in-store visit recommendation. */
  bestInStore: BasketStoreResult | null;
  /**
   * Within a 1-line band of max orderable coverage (priced lines with a non-null
   * storefront link). Null when no store has any orderable lines.
   */
  bestOrderable: BasketStoreResult | null;
}

/**
 * Fraction of the best available coverage a store must meet to be eligible
 * for `cheapest`. Keeps "cheapest" from picking a store that only stocks a
 * sliver of the basket just because its (tiny) total is lowest.
 */
const COVERAGE_FRACTION = 0.8;

/**
 * Picks complementary recommendations from priced store results.
 * An empty store list yields all nulls.
 */
export function pickRecommendations(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): StoreRecommendations {
  if (stores.length === 0) {
    return { cheapest: null, bestNearby: null, bestInStore: null, bestOrderable: null };
  }

  const cheapest = pickCheapest(stores);
  const bestInStore = pickCoverageBand(stores, coveredLines, opts, { requirePositive: false });
  const bestOrderable = pickCoverageBand(stores, coveredOrderableLines, opts, {
    requirePositive: true,
  });

  return {
    cheapest,
    bestNearby: bestInStore,
    bestInStore,
    bestOrderable,
  };
}

function pickCheapest(stores: BasketStoreResult[]): BasketStoreResult {
  const maxCov = Math.max(...stores.map(coveredLines));
  const floor = Math.max(1, Math.ceil(maxCov * COVERAGE_FRACTION));
  const eligible = stores.filter((s) => coveredLines(s) >= floor);
  const cheapestPool = eligible.length > 0 ? eligible : stores;
  return [...cheapestPool].sort((a, b) => {
    const total = a.total - b.total;
    if (total !== 0) return total;
    return coveredLines(b) - coveredLines(a);
  })[0]!;
}

/**
 * Prefer stores within 1 line of max coverage, then rank by effective cost
 * (total + optional distance penalty), then higher coverage.
 */
function pickCoverageBand(
  stores: BasketStoreResult[],
  coverageFn: (s: BasketStoreResult) => number,
  opts: RecommendationOptions,
  bandOpts: { requirePositive: boolean },
): BasketStoreResult | null {
  const pool = bandOpts.requirePositive
    ? stores.filter((s) => coverageFn(s) > 0)
    : stores;
  if (pool.length === 0) return null;

  const maxCov = Math.max(...pool.map(coverageFn));
  if (bandOpts.requirePositive && maxCov <= 0) return null;

  const eligible = pool.filter((s) => coverageFn(s) >= maxCov - 1);
  return [...eligible].sort((a, b) => {
    // Band already limits to maxCov / maxCov-1. Rank by effective cost (total
    // alone when distance is unreliable), then prefer fuller coverage.
    const cost = effectiveCost(a, opts) - effectiveCost(b, opts);
    if (cost !== 0) return cost;
    return coverageFn(b) - coverageFn(a);
  })[0]!;
}

/** Priced-line count: the lines the store actually filled for this basket. */
function coveredLines(s: BasketStoreResult): number {
  return s.lines.length;
}

/** Priced lines that have a storefront link (orderable online). */
function coveredOrderableLines(s: BasketStoreResult): number {
  return s.lines.filter((l) => l.link != null).length;
}

/**
 * Effective travel+basket cost. Unknown branch distance (null km while distance
 * is otherwise reliable) is treated as far — prefer stores with real address/feed
 * coords over city-centroid placeholders that would otherwise look "nearby".
 */
function effectiveCost(s: BasketStoreResult, opts: RecommendationOptions): number {
  const distanceReliable = opts.distanceReliable !== false;
  if (!distanceReliable) return s.total;
  const UNKNOWN_DISTANCE_KM = 50;
  const km = s.distanceKm ?? UNKNOWN_DISTANCE_KM;
  return s.total + km * opts.distancePenaltyPerKm;
}
