import {
  isEligibleForDistanceRecommendation,
  type StoreLocationMetadata,
} from "../../lib/resolveStoreLocation.js";
import type { StoreSummary } from "../stores/index.js";
import { buildComparableCosts, comparableCostFor } from "./comparableBasket.js";
import {
  pickBestSingleStore,
  pickCheapestCompleteStore,
  pickClosestUsefulStore,
  type RecommendationOptions,
} from "./recommendStores.js";
import { buildMultiStorePlan } from "./substitutions.js";
import type {
  BasketCoverage,
  BasketMultiStorePlan,
  BasketStorePlan,
  BasketStoreResult,
  BasketTotalScope,
  ComparableCost,
  ResolvedItem,
} from "./types.js";

function coverage(
  pricedLines: number,
  resolvableLines: number,
  requestedLines: number,
): BasketCoverage {
  return {
    pricedLines,
    resolvableLines,
    requestedLines,
    coverageRatio: requestedLines === 0 ? 0 : pricedLines / requestedLines,
  };
}

function totalScopeFor(coverageRatio: number): BasketTotalScope {
  return coverageRatio < 1 ? "priced_lines_only" : "complete_basket";
}

export function toStorePlan(
  store: BasketStoreResult | null,
  resolvableLines: number,
  requestedLines: number,
  comparableCosts?: Map<string, ComparableCost>,
): BasketStorePlan | null {
  if (!store) return null;
  const cov = coverage(store.lines.length, resolvableLines, requestedLines);
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    chainId: store.chainId,
    chainName: store.chainName,
    total: store.total,
    totalScope: totalScopeFor(cov.coverageRatio),
    currency: store.currency,
    distanceKm: store.distanceKm,
    distanceAccuracy: store.distanceAccuracy,
    lines: store.lines,
    missingItems: store.missingItems,
    ...comparableCostFor(store, comparableCosts),
    ...cov,
  };
}

export function toMultiStorePlan(
  plan: ReturnType<typeof buildMultiStorePlan>,
  resolvableLines: number,
  requestedLines: number,
): BasketMultiStorePlan | null {
  if (!plan) return null;
  const cov = coverage(plan.lines.length, resolvableLines, requestedLines);
  return {
    total: plan.total,
    totalScope: totalScopeFor(cov.coverageRatio),
    currency: plan.currency,
    storeCount: plan.storeCount,
    stops: plan.stops,
    maxDistanceKm: plan.maxDistanceKm,
    estimatedTravelKm: plan.estimatedTravelKm,
    clubOnlyLines: plan.clubOnlyLines,
    lines: plan.lines,
    missingItemIndexes: plan.missingItemIndexes,
    ...cov,
  };
}

export interface RecommendationPlans {
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  closestStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
  bestSingleStoreResult: BasketStoreResult | null;
  /** Same-basket costs used for ranking, so callers can order `stores` the same way. */
  comparableCosts: Map<string, ComparableCost>;
}

export interface RecommendationPlanContext {
  location: StoreLocationMetadata;
  /** Candidate stores keyed by id — used for locality eligibility. */
  storesById: Map<string, StoreSummary>;
}

function filterEligibleStoreResults(
  storeResults: BasketStoreResult[],
  ctx: RecommendationPlanContext | undefined,
): BasketStoreResult[] {
  if (!ctx) return storeResults;
  return storeResults.filter((result) => {
    const summary = ctx.storesById.get(result.storeId);
    if (!summary) return false;
    return isEligibleForDistanceRecommendation(summary, ctx.location);
  });
}

export function buildRecommendationPlans(
  storeResults: BasketStoreResult[],
  resolvedItems: ResolvedItem[],
  opts: RecommendationOptions,
  requestedLines: number,
  eligibility?: RecommendationPlanContext,
): RecommendationPlans {
  const resolvableLines = resolvedItems.filter((item) => item.productId != null).length;
  const eligibleResults = filterEligibleStoreResults(storeResults, eligibility);

  // Reference prices come from the ELIGIBLE set: imputing a line at the price of
  // a store the shopper can never use (an online warehouse, or a branch outside
  // the radius) would distort every comparison.
  const comparableCosts = buildComparableCosts(eligibleResults);
  const rankingOpts: RecommendationOptions = { ...opts, comparableCosts };

  const bestSingleStoreResult = pickBestSingleStore(eligibleResults, rankingOpts);
  const cheapestCompleteResult = pickCheapestCompleteStore(eligibleResults, resolvableLines);
  const closestResult = pickClosestUsefulStore(eligibleResults, rankingOpts);

  return {
    bestSingleStore: toStorePlan(
      bestSingleStoreResult,
      resolvableLines,
      requestedLines,
      comparableCosts,
    ),
    cheapestCompleteStore: toStorePlan(
      cheapestCompleteResult,
      resolvableLines,
      requestedLines,
      comparableCosts,
    ),
    closestStore: toStorePlan(closestResult, resolvableLines, requestedLines, comparableCosts),
    multiStore: toMultiStorePlan(
      buildMultiStorePlan(resolvedItems, eligibleResults, {
        distancePenaltyPerKm: opts.distancePenaltyPerKm,
        distanceReliable: opts.distanceReliable,
      }),
      resolvableLines,
      requestedLines,
    ),
    bestSingleStoreResult,
    comparableCosts,
  };
}
