import { buildComparableCosts, comparableCostFor } from "./comparableBasket.js";
import type {
  BasketPreference,
  BasketStoreResult,
  ComparableCost,
  DistanceAccuracy,
} from "./types.js";

/** Default shekels of "cost" per km when ranking stores (balanced preference). */
export const DEFAULT_DISTANCE_PENALTY_PER_KM = 3;

/**
 * Shekels per km implied by each preference.
 *
 * "cheapest" is 0 rather than a small number so the shopper who says distance is
 * not a factor really gets the cheapest in-radius store. "closest" is high
 * enough that price differences of a normal weekly basket (tens of shekels)
 * cannot outweigh a couple of extra km, which is what "just the nearest place"
 * means in practice.
 */
const PREFERENCE_DISTANCE_PENALTY: Record<BasketPreference, number> = {
  cheapest: 0,
  balanced: DEFAULT_DISTANCE_PENALTY_PER_KM,
  closest: 60,
};

/**
 * How many priced lines a store may give up to win on the preference's own terms.
 *
 * Coverage is the shopper's real constraint: a store that is 1km away but stocks
 * half the list is a wasted trip. "closest" tolerates the most, because someone
 * optimising for proximity has already said they will top up elsewhere; but even
 * then the floor is a band below the best achievable coverage, never unlimited.
 */
const PREFERENCE_COVERAGE_BAND: Record<BasketPreference, number> = {
  cheapest: 1,
  balanced: 1,
  closest: 3,
};

export const DEFAULT_BASKET_PREFERENCE: BasketPreference = "balanced";

/** Distance penalty for a preference, unless the caller pinned one explicitly. */
export function distancePenaltyForPreference(
  preference: BasketPreference | undefined,
  explicitPenaltyPerKm: number | undefined,
): number {
  if (explicitPenaltyPerKm != null) return explicitPenaltyPerKm;
  return PREFERENCE_DISTANCE_PENALTY[preference ?? DEFAULT_BASKET_PREFERENCE];
}

export function coverageBandForPreference(preference: BasketPreference | undefined): number {
  return PREFERENCE_COVERAGE_BAND[preference ?? DEFAULT_BASKET_PREFERENCE];
}

export interface RecommendationOptions {
  /** Shekels of "cost" per km of distance when comparing stores. */
  distancePenaltyPerKm: number;
  /**
   * When false, distance is ignored in ranking (e.g. city-precision origin with
   * no usable branch coordinates anywhere). Defaults to true for pure unit tests.
   */
  distanceReliable?: boolean;
  /** Travel-vs-price appetite; drives the coverage band. Defaults to balanced. */
  preference?: BasketPreference;
  /**
   * Same-basket totals from `buildComparableCosts`. When absent (pure unit
   * tests) each store's observed `total` is used as-is.
   */
  comparableCosts?: Map<string, ComparableCost>;
}

/** Distance to charge for when the figure is missing entirely. */
const UNKNOWN_DISTANCE_KM = 50;

/**
 * How far a city-centroid store may really be from the centroid we placed it on.
 *
 * A centroid puts the store somewhere in its city rather than nowhere, so
 * excluding those stores outright was too harsh — it hid whole chains (every
 * Rami Levy branch in the Sharon at one point). But treating the centroid
 * distance as the store's distance is a fabrication, and it fabricates in the
 * direction that costs the shopper a wasted drive: someone living near their
 * city centre sees every unlocated branch in that city as next door.
 *
 * Measured, not guessed: over the 499 located branches inside the coverage area,
 * the RMS distance from a branch to its own city centroid is 2.60 km (mean 2.03,
 * median 1.57, p90 4.26). Tel Aviv alone spreads its branches up to 6.4 km from
 * the middle.
 */
export const CITY_UNCERTAINTY_RADIUS_KM = 2.6;

/**
 * The distance we can actually defend for a store, given how we located it.
 *
 * Combined in quadrature rather than added, because the uncertainty is an offset
 * in an unknown DIRECTION, not extra road. Close up it dominates (a store at the
 * centroid is reported at 2.6 km, not 0); far away it all but vanishes (40 km
 * becomes 40.08, since which edge of a distant city a store sits on barely
 * changes the trip). The old flat +3 km got both ends wrong: it let a centroid
 * store 0.6 km from the shopper claim 3.6 km when 7 km was the truth, and it
 * charged a 40 km store as 43 km, distorting every long-range comparison.
 *
 * Every distance is rounded to 10 m, measured ones included. 0.6149685404435874
 * dressed a guess in sixteen digits, but even a real branch distance is a
 * straight line between coordinates stored to ~5 decimal places, not a driving
 * route — the digits past the second were never information.
 *
 * Applied ONCE, where a store result is built, so the figure the caller reads is
 * the same one the ranking used. Nothing downstream re-inflates it.
 */
export function estimatedDistanceKm(
  distanceKm: number | null,
  accuracy: DistanceAccuracy,
): number | null {
  if (distanceKm == null) return null;
  const km =
    accuracy === "city"
      ? Math.sqrt(distanceKm * distanceKm + CITY_UNCERTAINTY_RADIUS_KM ** 2)
      : distanceKm;
  return Math.round(km * 100) / 100;
}

/**
 * Distance used for ranking.
 *
 * The uncertainty is already baked in by `estimatedDistanceKm` at construction,
 * so this only has to price the case where there is no figure at all.
 */
export function rankingDistanceKm(
  distanceKm: number | null,
  accuracy: DistanceAccuracy,
): number {
  if (distanceKm == null || accuracy === "unknown") return UNKNOWN_DISTANCE_KM;
  return distanceKm;
}

/**
 * What an unfinished basket costs the shopper beyond money, in shekels.
 *
 * `comparableTotal` prices the missing lines at market rate, which stops a store
 * looking cheap for not stocking things — but on its own it still treats "buy the
 * tuna somewhere else" as free. It is not: it is another trip. Without this
 * surcharge a store that saves ₪3 while forcing a second stop outranks one that
 * finishes the list. Set to match the multi-store plan's own "worth another stop"
 * floor (MULTISTORE_MIN_MARGINAL_SAVINGS), so the two models agree on what a stop
 * is worth. A store cheap enough to beat it still wins, which is correct — that is
 * a real trade-off, and `imputedLines` tells the caller it exists.
 */
export const INCOMPLETE_BASKET_TRIP_SURCHARGE = 20;

/**
 * Added per missing line BEYOND the first.
 *
 * The trip itself is the big fixed cost, but a flat charge makes a store missing
 * four lines look exactly as convenient as one missing a single line, which is
 * wrong — and it matters most under `preference: "closest"`, whose coverage band
 * is deliberately wide enough for that gap to appear. Set to a quarter of the trip
 * charge: an extra item on an errand you are already making costs a fraction of
 * the errand. Keeping it well below the trip charge means coverage never
 * out-shouts a genuinely large price difference.
 */
export const INCOMPLETE_BASKET_PER_LINE_SURCHARGE = 5;

/** Ranking-only penalty for a basket this store cannot finish. */
function incompleteBasketPenalty(imputedLines: number): number {
  if (imputedLines <= 0) return 0;
  return (
    INCOMPLETE_BASKET_TRIP_SURCHARGE +
    INCOMPLETE_BASKET_PER_LINE_SURCHARGE * (imputedLines - 1)
  );
}

/**
 * Effective ranking cost: comparable basket + travel + the cost of not finishing.
 *
 * Uses `comparableTotal` (observed lines + market reference for missing ones) so
 * a store cannot look cheap by not stocking the expensive item. Ranking-only —
 * the surcharge is deliberately NOT folded into the reported `comparableTotal`,
 * which stays a pure money figure the caller can explain.
 */
export function effectiveCost(s: BasketStoreResult, opts: RecommendationOptions): number {
  const { comparableTotal, imputedLines } = comparableCostFor(s, opts.comparableCosts);
  const incompletePenalty = incompleteBasketPenalty(imputedLines);
  const distanceReliable = opts.distanceReliable !== false;
  if (!distanceReliable) return comparableTotal + incompletePenalty;
  const km = rankingDistanceKm(s.distanceKm, s.distanceAccuracy);
  return comparableTotal + incompletePenalty + km * opts.distancePenaltyPerKm;
}

/**
 * Guarantee the ranking is done on a comparable basis.
 *
 * Without a cost map, `comparableCostFor` falls back to each store's raw `total`,
 * and raw totals are exactly what made the least-stocked store look cheapest. That
 * fallback is fine for reading one store's numbers but NOT for ordering several, so
 * derive the map here when the caller did not supply one. Keeps the pick identical
 * whether it comes from `buildRecommendationPlans` or a direct unit-test call.
 */
function withComparableCosts(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): RecommendationOptions {
  if (opts.comparableCosts) return opts;
  return { ...opts, comparableCosts: buildComparableCosts(stores) };
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
 * Primary single-store pick: cheapest effective cost within the coverage band.
 *
 * Completeness is NOT a short circuit. It used to be: any store pricing every
 * resolvable line beat every incomplete store regardless of price, so a ₪300
 * complete store won against a ₪60 store missing one ₪20 item. That rule existed
 * because an incomplete store's `total` was not comparable to a complete one's —
 * which `comparableTotal` now fixes. Effective cost already prices completeness
 * properly: missing lines are charged at the market median, plus a trip surcharge
 * that scales with how many are missing. A complete store has no imputation and no
 * surcharge, so it wins whenever it is genuinely the better deal, and loses only
 * when an incomplete store beats it by more than the second trip is worth.
 *
 * The coverage band remains as a floor so a store that stocks almost nothing
 * cannot win on price alone. Callers who need a guaranteed single-trip answer
 * should read `cheapestCompleteStore`, which is exactly that.
 *
 * There is deliberately no `completeLineCount` escape hatch. An earlier version
 * took one, intending it to widen the band to always admit fully-stocked stores,
 * but it could never bind: a store cannot price more lines than are resolvable, so
 * `maxCoverage <= resolvableLines` always holds and the band floor was already the
 * smaller term. Keeping an inert parameter with a docstring claiming otherwise is
 * worse than not having it.
 */
export function pickBestSingleStore(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): BasketStoreResult | null {
  if (stores.length === 0) return null;

  const ranking = withComparableCosts(stores, opts);
  const maxCoverage = Math.max(...stores.map((store) => store.lines.length));
  const band = coverageBandForPreference(opts.preference);
  const eligible = stores.filter((store) => store.lines.length >= maxCoverage - band);
  return sortByEffectiveCost(eligible, ranking);
}

/**
 * Lowest-total store that prices every resolvable line; null if none is complete.
 *
 * Deliberately ignores distance: this is the "I don't mind driving" answer, and
 * because it is complete its `total` needs no imputation to be comparable.
 */
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

/**
 * Nearest store that still clears the preference's coverage band.
 *
 * Answers "price is not a big factor" directly, which no plan did before: the
 * caller had to guess at `distance_penalty_per_km` and even then the complete-store
 * short-circuit usually made it inert.
 */
export function pickClosestUsefulStore(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): BasketStoreResult | null {
  if (stores.length === 0) return null;
  opts = withComparableCosts(stores, opts);
  const maxCoverage = Math.max(...stores.map((store) => store.lines.length));
  const band = coverageBandForPreference(opts.preference);
  const eligible = stores.filter((store) => store.lines.length >= maxCoverage - band);
  const pool = eligible.length > 0 ? eligible : stores;
  return (
    [...pool].sort((a, b) => {
      const aKm = rankingDistanceKm(a.distanceKm, a.distanceAccuracy);
      const bKm = rankingDistanceKm(b.distanceKm, b.distanceAccuracy);
      if (aKm !== bKm) return aKm - bKm;
      const aCost = comparableCostFor(a, opts.comparableCosts).comparableTotal;
      const bCost = comparableCostFor(b, opts.comparableCosts).comparableTotal;
      return aCost - bCost || a.storeId.localeCompare(b.storeId);
    })[0] ?? null
  );
}
