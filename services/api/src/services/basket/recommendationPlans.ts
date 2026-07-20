import { pickBestSingleStore, pickCheapestCompleteStore, type RecommendationOptions } from "./recommendStores.js";
import { buildMultiStorePlan } from "./substitutions.js";
import type {
  BasketCoverage,
  BasketMultiStorePlan,
  BasketStorePlan,
  BasketStoreResult,
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

export function toStorePlan(
  store: BasketStoreResult | null,
  resolvableLines: number,
  requestedLines: number,
): BasketStorePlan | null {
  if (!store) return null;
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    chainId: store.chainId,
    chainName: store.chainName,
    total: store.total,
    currency: store.currency,
    distanceKm: store.distanceKm,
    lines: store.lines,
    missingItems: store.missingItems,
    ...coverage(store.lines.length, resolvableLines, requestedLines),
  };
}

export function toMultiStorePlan(
  plan: ReturnType<typeof buildMultiStorePlan>,
  resolvableLines: number,
  requestedLines: number,
): BasketMultiStorePlan | null {
  if (!plan) return null;
  return {
    total: plan.total,
    currency: plan.currency,
    storeCount: plan.storeCount,
    lines: plan.lines,
    missingItemIndexes: plan.missingItemIndexes,
    ...coverage(plan.lines.length, resolvableLines, requestedLines),
  };
}

export interface RecommendationPlans {
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
  bestSingleStoreResult: BasketStoreResult | null;
}

export function buildRecommendationPlans(
  storeResults: BasketStoreResult[],
  resolvedItems: ResolvedItem[],
  opts: RecommendationOptions,
  requestedLines: number,
): RecommendationPlans {
  const resolvableLines = resolvedItems.filter((item) => item.productId != null).length;
  const bestSingleStoreResult = pickBestSingleStore(storeResults, opts);
  const cheapestCompleteResult = pickCheapestCompleteStore(storeResults, resolvableLines);
  return {
    bestSingleStore: toStorePlan(bestSingleStoreResult, resolvableLines, requestedLines),
    cheapestCompleteStore: toStorePlan(cheapestCompleteResult, resolvableLines, requestedLines),
    multiStore: toMultiStorePlan(
      buildMultiStorePlan(resolvedItems, storeResults),
      resolvableLines,
      requestedLines,
    ),
    bestSingleStoreResult,
  };
}
