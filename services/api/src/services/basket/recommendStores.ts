import type { BasketStoreResult } from "./types.js";

/** Default shekels of "cost" per km when ranking equal-coverage stores. */
export const DEFAULT_DISTANCE_PENALTY_PER_KM = 3;

export interface RecommendationOptions {
  /** Shekels of "cost" per km of distance when comparing equal-coverage stores. */
  distancePenaltyPerKm: number;
  /**
   * When false, distance is ignored in ranking (e.g. city_centroid-only coords).
   * Defaults to true for pure unit tests.
   */
  distanceReliable?: boolean;
}

/**
 * Effective travel+basket cost. Unknown branch distance (null km while distance
 * is otherwise reliable) is treated as far — prefer stores with real address/feed
 * coords over city-centroid placeholders that would otherwise look "nearby".
 */
export function effectiveCost(s: BasketStoreResult, opts: RecommendationOptions): number {
  const distanceReliable = opts.distanceReliable !== false;
  if (!distanceReliable) return s.total;
  const UNKNOWN_DISTANCE_KM = 50;
  const km = s.distanceKm ?? UNKNOWN_DISTANCE_KM;
  return s.total + km * opts.distancePenaltyPerKm;
}

function sortByEffectiveCost(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): BasketStoreResult | null {
  return (
    [...stores].sort(
      (a, b) =>
        effectiveCost(a, opts) - effectiveCost(b, opts) ||
        b.lines.length - a.lines.length ||
        a.storeId.localeCompare(b.storeId),
    )[0] ?? null
  );
}

/**
 * Primary single-store pick.
 *
 * A store that prices every resolvable line (complete) always beats any
 * incomplete store, regardless of price. Among incomplete stores only, maximize
 * coverage within a 1-line band of the max, then minimize effective cost.
 */
export function pickBestSingleStore(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
  /** When set, stores with this many priced lines are treated as complete. */
  completeLineCount?: number,
): BasketStoreResult | null {
  if (stores.length === 0) return null;

  if (completeLineCount != null && completeLineCount > 0) {
    const complete = stores.filter((store) => store.lines.length >= completeLineCount);
    if (complete.length > 0) {
      return sortByEffectiveCost(complete, opts);
    }
  }

  const maxCoverage = Math.max(...stores.map((store) => store.lines.length));
  const eligible = stores.filter((store) => store.lines.length >= maxCoverage - 1);
  return sortByEffectiveCost(eligible, opts);
}

/** Lowest-total store that prices every resolvable line; null if none is complete. */
export function pickCheapestCompleteStore(
  stores: BasketStoreResult[],
  resolvableLines: number,
): BasketStoreResult | null {
  if (resolvableLines <= 0) return null;
  return (
    [...stores]
      .filter((store) => store.lines.length === resolvableLines)
      .sort(
        (a, b) =>
          a.total - b.total ||
          (a.distanceKm ?? Number.POSITIVE_INFINITY) -
            (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
          a.storeId.localeCompare(b.storeId),
      )[0] ?? null
  );
}
