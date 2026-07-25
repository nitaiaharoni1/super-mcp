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
 * Extra km charged for a city-centroid distance.
 *
 * A centroid puts the store somewhere in its city rather than nowhere, so the
 * old behaviour of excluding those stores outright was too harsh — it hid whole
 * chains (every Rami Levy branch in the Sharon at one point). Charging a
 * city-sized uncertainty instead keeps them rankable while still preferring a
 * store whose position we actually know.
 */
const CITY_ACCURACY_UNCERTAINTY_KM = 3;

/** Distance used for ranking, inflated by how little we trust it. */
export function rankingDistanceKm(
  distanceKm: number | null,
  accuracy: DistanceAccuracy,
): number {
  if (distanceKm == null || accuracy === "unknown") return UNKNOWN_DISTANCE_KM;
  if (accuracy === "city") return distanceKm + CITY_ACCURACY_UNCERTAINTY_KM;
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
