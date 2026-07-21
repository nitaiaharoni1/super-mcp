import {
  isEligibleForDistanceRecommendation,
  type StoreLocationMetadata,
} from "../../lib/resolveStoreLocation.js";
import type { StoreSummary } from "../stores/index.js";
import { pickBestSingleStore, pickCheapestCompleteStore, type RecommendationOptions } from "./recommendStores.js";
import { buildMultiStorePlan } from "./substitutions.js";
import type {
  BasketCoverage,
  BasketMultiStorePlan,
  BasketStorePlan,
  BasketStoreResult,
  BasketTotalScope,
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
    lines: store.lines,
    missingItems: store.missingItems,
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
    lines: plan.lines,
    missingItemIndexes: plan.missingItemIndexes,
    ...cov,
  };
}

export interface RecommendationPlans {
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
  bestSingleStoreResult: BasketStoreResult | null;
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
  const bestSingleStoreResult = pickBestSingleStore(eligibleResults, opts);
  const cheapestCompleteResult = pickCheapestCompleteStore(eligibleResults, resolvableLines);
  return {
    bestSingleStore: toStorePlan(bestSingleStoreResult, resolvableLines, requestedLines),
    cheapestCompleteStore: toStorePlan(cheapestCompleteResult, resolvableLines, requestedLines),
    multiStore: toMultiStorePlan(
      buildMultiStorePlan(resolvedItems, eligibleResults),
      resolvableLines,
      requestedLines,
    ),
    bestSingleStoreResult,
  };
}
