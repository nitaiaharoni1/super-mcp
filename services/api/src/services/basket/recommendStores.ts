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

/**
 * Primary single-store pick: maximize coverage within a 1-line band of the max,
 * then minimize effective cost, then prefer fuller coverage, then store id.
 */
export function pickBestSingleStore(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): BasketStoreResult | null {
  if (stores.length === 0) return null;
  const maxCoverage = Math.max(...stores.map((store) => store.lines.length));
  const eligible = stores.filter((store) => store.lines.length >= maxCoverage - 1);
  return (
    [...eligible].sort(
      (a, b) =>
        effectiveCost(a, opts) - effectiveCost(b, opts) ||
        b.lines.length - a.lines.length ||
        a.storeId.localeCompare(b.storeId),
    )[0] ?? null
  );
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
