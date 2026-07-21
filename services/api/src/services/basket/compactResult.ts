import type {
  BasketAssumption,
  BasketCompleteResult,
  BasketCoverageSummary,
  BasketItemStatus,
  BasketMultiStorePlan,
  BasketNeedsConfirmationResult,
  BasketOmittedItem,
  BasketOptimizeResult,
  BasketResponseDetail,
  BasketStorePlan,
  BasketStoreResult,
  BasketSummaryItem,
} from "./types.js";

const SUMMARY_NEXT_STEP = {
  tool: "optimize_basket" as const,
  useOnly: ["continuation", "answers"] as ["continuation", "answers"],
  doNotCall: ["search_products", "resolve_products", "compare_prices"] as [
    "search_products",
    "resolve_products",
    "compare_prices",
  ],
};

/**
 * Precedence for deprecated verbose:
 * response_detail supplied → use it
 * else verbose=true → debug
 * else → summary
 */
export function resolveResponseDetail(
  responseDetail: BasketResponseDetail | undefined,
  verbose: boolean | undefined,
): BasketResponseDetail {
  if (responseDetail != null) {
    switch (responseDetail) {
      case "summary":
        return "summary";
      case "standard":
        return "standard";
      case "debug":
        return "debug";
      default: {
        const exhaustive: never = responseDetail;
        return exhaustive;
      }
    }
  }
  if (verbose === true) return "debug";
  return "summary";
}

function toSummaryItems(items: BasketItemStatus[]): BasketSummaryItem[] {
  return items.map(({ candidates: _candidates, ...rest }) => rest);
}

function stripItemCandidates(items: BasketItemStatus[]): BasketItemStatus[] {
  return items.map((item) => ({ ...item, candidates: [] }));
}

function buildOmittedItems(assumptions: BasketAssumption[]): BasketOmittedItem[] {
  return assumptions
    .filter((entry) => entry.reason === "unsafe_line_omitted")
    .map((entry) => ({
      itemIndex: entry.itemIndex,
      query: entry.query,
      reason: entry.reason,
      message: entry.message,
    }));
}

function buildCoverage(
  result: BasketCompleteResult,
  omittedItems: BasketOmittedItem[],
): BasketCoverageSummary {
  const requestedLines =
    result.bestSingleStore?.requestedLines ??
    result.cheapestCompleteStore?.requestedLines ??
    result.multiStore?.requestedLines ??
    result.items.length;
  const pricedLines =
    result.bestSingleStore?.pricedLines ??
    result.cheapestCompleteStore?.pricedLines ??
    result.multiStore?.pricedLines ??
    0;
  return {
    requestedLines,
    pricedLines,
    omittedLines: omittedItems.length,
  };
}

/**
 * Deduplicate identical single-store plans and, for summary, keep at most two
 * recommendation slots (best → cheapestComplete → multiStore).
 */
export function selectRecommendationPlans(
  bestSingleStore: BasketStorePlan | null,
  cheapestCompleteStore: BasketStorePlan | null,
  multiStore: BasketMultiStorePlan | null,
  detail: BasketResponseDetail,
): {
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
} {
  const cheapest =
    bestSingleStore &&
    cheapestCompleteStore &&
    bestSingleStore.storeId === cheapestCompleteStore.storeId
      ? null
      : cheapestCompleteStore;

  switch (detail) {
    case "debug":
    case "standard":
      return {
        bestSingleStore,
        cheapestCompleteStore: cheapest,
        multiStore,
      };
    case "summary": {
      type PlanKey = "bestSingleStore" | "cheapestCompleteStore" | "multiStore";
      const candidates: Array<[PlanKey, BasketStorePlan | BasketMultiStorePlan | null]> = [
        ["bestSingleStore", bestSingleStore],
        ["cheapestCompleteStore", cheapest],
        ["multiStore", multiStore],
      ];
      const selected: {
        bestSingleStore: BasketStorePlan | null;
        cheapestCompleteStore: BasketStorePlan | null;
        multiStore: BasketMultiStorePlan | null;
      } = {
        bestSingleStore: null,
        cheapestCompleteStore: null,
        multiStore: null,
      };
      let kept = 0;
      for (const [key, plan] of candidates) {
        if (plan == null || kept >= 2) continue;
        if (key === "multiStore") {
          selected.multiStore = plan as BasketMultiStorePlan;
        } else if (key === "bestSingleStore") {
          selected.bestSingleStore = plan as BasketStorePlan;
        } else {
          selected.cheapestCompleteStore = plan as BasketStorePlan;
        }
        kept += 1;
      }
      return selected;
    }
    default: {
      const exhaustive: never = detail;
      return exhaustive;
    }
  }
}

function trimStoresForDetail(
  stores: BasketStoreResult[] | undefined,
  detail: BasketResponseDetail,
  recommendedIds: Array<string | undefined>,
): BasketStoreResult[] | undefined {
  if (stores == null) return undefined;
  switch (detail) {
    case "summary":
      return undefined;
    case "standard": {
      const keep = new Set(recommendedIds.filter((id): id is string => Boolean(id)));
      return stores.map((store) => (keep.has(store.storeId) ? store : { ...store, lines: [] }));
    }
    case "debug":
      return stores;
    default: {
      const exhaustive: never = detail;
      return exhaustive;
    }
  }
}

function projectComplete(
  result: BasketCompleteResult,
  detail: BasketResponseDetail,
): BasketCompleteResult {
  const plans = selectRecommendationPlans(
    result.bestSingleStore,
    result.cheapestCompleteStore,
    result.multiStore,
    detail,
  );
  const omittedItems = buildOmittedItems(result.assumptions);
  const coverage = buildCoverage({ ...result, ...plans }, omittedItems);
  const itemStatuses = result.items as BasketItemStatus[];

  switch (detail) {
    case "summary":
      return {
        status: "complete",
        ...plans,
        items: toSummaryItems(itemStatuses),
        location: result.location,
        assumptions: result.assumptions,
        coverage,
        omittedItems,
      };
    case "standard":
      return {
        status: "complete",
        ...plans,
        items: stripItemCandidates(itemStatuses),
        stores: trimStoresForDetail(result.stores, detail, [
          plans.bestSingleStore?.storeId,
          plans.cheapestCompleteStore?.storeId,
        ]),
        storesCompared: result.storesCompared,
        storesTruncated: result.storesTruncated,
        location: result.location,
        assumptions: result.assumptions,
        coverage,
        omittedItems,
      };
    case "debug":
      return {
        status: "complete",
        ...plans,
        items: itemStatuses,
        stores: trimStoresForDetail(result.stores, detail, [
          plans.bestSingleStore?.storeId,
          plans.cheapestCompleteStore?.storeId,
        ]),
        storesCompared: result.storesCompared,
        storesTruncated: result.storesTruncated,
        location: result.location,
        assumptions: result.assumptions,
        coverage,
        omittedItems,
        timings: result.timings,
      };
    default: {
      const exhaustive: never = detail;
      return exhaustive;
    }
  }
}

function projectNeedsConfirmation(
  result: BasketNeedsConfirmationResult,
  detail: BasketResponseDetail,
): BasketNeedsConfirmationResult {
  switch (detail) {
    case "summary":
      return {
        status: "needs_confirmation",
        continuation: result.continuation,
        questions: result.questions,
        preview: result.preview,
        nextStep: SUMMARY_NEXT_STEP,
        location: result.location,
      };
    case "standard":
    case "debug":
      return {
        status: "needs_confirmation",
        continuation: result.continuation,
        questions: result.questions,
        preview: result.preview,
        items: result.items,
        location: result.location,
      };
    default: {
      const exhaustive: never = detail;
      return exhaustive;
    }
  }
}

/** Project a full basket result down to the requested response detail. */
export function projectBasketResult(
  result: BasketOptimizeResult,
  detail: BasketResponseDetail,
): BasketOptimizeResult {
  switch (result.status) {
    case "complete":
      return projectComplete(result, detail);
    case "needs_confirmation":
      return projectNeedsConfirmation(result, detail);
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
