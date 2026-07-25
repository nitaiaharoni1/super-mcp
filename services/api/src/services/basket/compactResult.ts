import type {
  BasketAssumption,
  BasketCompleteResult,
  BasketLine,
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
  // Keep what answers "what happened to each thing I asked for": the chosen
  // product, quantity, and resolution status. Drop the rest as diagnostic or
  // redundant — `substitution` is a nested explain object repeating both product
  // names (the priced line already carries `substituted`), `resolved` restates
  // `resolutionStatus`, and `confidence`/`lowConfidence` are scoring internals.
  // On an 18-item basket the item array alone cost 11KB of a 27KB summary.
  return items.map(
    ({
      candidates: _candidates,
      substitution: _substitution,
      resolved: _resolved,
      confidence: _confidence,
      lowConfidence: _lowConfidence,
      ...rest
    }) => rest as BasketSummaryItem,
  );
}

/**
 * Strip per-line fields that explain a line rather than let a caller act on it.
 *
 * Summary has a byte budget (the perf suite asserts 22KB) and the kept plan's
 * `lines` array grows with basket size, so a normal 18-item weekly list came to
 * 27KB. Measured per-field cost across 15 lines: `substitutionReason` 1.9KB,
 * `originalProductId` 0.85KB, `listingId` 0.8KB, `itemCode` 0.4KB.
 *
 * What stays is what a shopper or agent needs: the product, its price, quantity,
 * pack size, normalized unit price, promo/club flags, the storefront link, the
 * `substituted` flag, and freshness (the MCP contract tells agents to check it).
 * The dropped fields all remain available at `standard` and `debug`.
 */
function toSummaryLines(lines: BasketLine[]): BasketLine[] {
  return lines.map((line) => ({
    ...line,
    listingId: "",
    itemCode: "",
    originalProductId: null,
    substitutionReason: null,
  }));
}

/**
 * Upper bound on priced lines echoed back in summary detail.
 *
 * The kept plan's `lines` array is the largest single term in the response and it
 * grows with basket size: measured 578 bytes/line, so the 50-item schema maximum
 * produced a 26KB array inside a 49KB response. Field pruning alone is a constant
 * factor and cannot bound that.
 *
 * 25 is above any realistic weekly list (a 30-item basket is already unusual), so
 * in practice nothing is ever truncated; it only stops a pathological request from
 * returning an unbounded payload. Truncation is never silent: `linesTruncated` is
 * set, `pricedLines` keeps the true count, and `standard`/`debug` return everything.
 */
export const SUMMARY_MAX_PLAN_LINES = 25;

function stripItemCandidates(items: BasketItemStatus[]): BasketItemStatus[] {
  return items.map((item) => ({ ...item, candidates: [] }));
}

/**
 * Drop the prose `message` from summary assumptions.
 *
 * It restates fields already present in the same object — `Assumed "<selectedName>"
 * for "<query>".` — so at summary detail it is pure duplication, and it cost 6.5KB
 * of a 33KB response on a 30-item basket. `omittedItems` keeps its message, since
 * that one explains WHY a line was dropped and is not derivable from the rest.
 * Full messages remain at `standard` and `debug`.
 */
function toSummaryAssumptions(assumptions: BasketAssumption[]): BasketAssumption[] {
  // Omit the key rather than send an empty string: `""` still costs bytes per
  // assumption and says nothing. `selectedProductId` goes too — it repeats the id
  // already on the item status and the priced line.
  return assumptions.map(
    ({ message: _message, selectedProductId: _selectedProductId, ...rest }) =>
      rest as BasketAssumption,
  );
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
    result.closestStore?.requestedLines ??
    result.multiStore?.requestedLines ??
    result.items.length;
  const pricedLines =
    result.bestSingleStore?.pricedLines ??
    result.cheapestCompleteStore?.pricedLines ??
    result.closestStore?.pricedLines ??
    result.multiStore?.pricedLines ??
    0;
  return {
    requestedLines,
    pricedLines,
    omittedLines: omittedItems.length,
  };
}

export interface SelectedRecommendationPlans {
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  closestStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
}

/**
 * Deduplicate single-store plans that landed on the same store and, for summary,
 * keep at most two recommendation slots so the payload stays inside the agent
 * budget (~15KB).
 *
 * Order of preference: best → cheapestComplete → closest → multiStore.
 * `closestStore` only earns a slot when it names a DIFFERENT store than the other
 * two — otherwise it says nothing new and just costs bytes.
 */
export function selectRecommendationPlans(
  bestSingleStore: BasketStorePlan | null,
  cheapestCompleteStore: BasketStorePlan | null,
  closestStore: BasketStorePlan | null,
  multiStore: BasketMultiStorePlan | null,
  detail: BasketResponseDetail,
): SelectedRecommendationPlans {
  const cheapest =
    bestSingleStore &&
    cheapestCompleteStore &&
    bestSingleStore.storeId === cheapestCompleteStore.storeId
      ? null
      : cheapestCompleteStore;

  const shownStoreIds = new Set(
    [bestSingleStore?.storeId, cheapest?.storeId].filter((id): id is string => Boolean(id)),
  );
  const closest =
    closestStore && !shownStoreIds.has(closestStore.storeId) ? closestStore : null;

  switch (detail) {
    case "debug":
    case "standard":
      return {
        bestSingleStore,
        cheapestCompleteStore: cheapest,
        closestStore: closest,
        multiStore,
      };
    case "summary": {
      type PlanKey = keyof SelectedRecommendationPlans;
      const candidates: Array<[PlanKey, BasketStorePlan | BasketMultiStorePlan | null]> = [
        ["bestSingleStore", bestSingleStore],
        ["cheapestCompleteStore", cheapest],
        ["closestStore", closest],
        ["multiStore", multiStore],
      ];
      const selected: SelectedRecommendationPlans = {
        bestSingleStore: null,
        cheapestCompleteStore: null,
        closestStore: null,
        multiStore: null,
      };
      // When one store already prices every line, skip multiStore in summary so
      // full-coverage baskets stay under the agent payload budget (~15KB).
      const bestCoversAll =
        bestSingleStore != null &&
        bestSingleStore.requestedLines > 0 &&
        bestSingleStore.pricedLines >= bestSingleStore.requestedLines;
      let kept = 0;
      for (const [key, plan] of candidates) {
        if (plan == null) continue;
        const maxSlots = key === "multiStore" && bestCoversAll ? 1 : 2;
        if (kept >= maxSlots) continue;
        if (key === "multiStore") {
          selected.multiStore = plan as BasketMultiStorePlan;
        } else {
          selected[key] = plan as BasketStorePlan;
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

/**
 * Summary keeps the full line breakdown for exactly ONE plan.
 *
 * A summary consumer needs to know that another option exists and what it costs —
 * its store, distance, total, comparableTotal and coverage — not its line-by-line
 * contents; that is what `standard` is for. Repeating ~800 bytes per line across
 * two plans pushed a 12-line basket to 30KB, with `closestStore` alone accounting
 * for 10KB.
 *
 * `multiStore` is included in the rule, not exempt from it. Its lines do carry
 * information the single-store plans do not (which stop each item comes from), but
 * `stops` now summarises the trip — store, distance, subtotal and line count per
 * stop — which is enough to decide whether the split is worth requesting in full.
 * Exempting it meant a partial-coverage basket, the very shape multiStore exists
 * for, shipped two full breakdowns: 7.1KB + 5.7KB measured on a 9-line basket.
 *
 * `missingItems` / `missingItemIndexes` always stay: they are small and tell the
 * caller what the alternative would cost them.
 */
function trimAlternativePlanLines(
  plans: SelectedRecommendationPlans,
): SelectedRecommendationPlans {
  let keptLines = false;
  const claimSlot = (): boolean => {
    if (keptLines) return false;
    keptLines = true;
    return true;
  };
  const keepOrStrip = (plan: BasketStorePlan | null): BasketStorePlan | null => {
    if (plan == null) return null;
    if (!claimSlot()) return { ...plan, lines: [] };
    const kept = toSummaryLines(plan.lines.slice(0, SUMMARY_MAX_PLAN_LINES));
    return plan.lines.length > kept.length
      ? { ...plan, lines: kept, linesTruncated: true }
      : { ...plan, lines: kept };
  };
  // Priority order matches the plan precedence, so the primary recommendation is
  // the one that keeps its breakdown. multiStore comes last and keeps its lines
  // only when it is the sole plan.
  const bestSingleStore = keepOrStrip(plans.bestSingleStore);
  const cheapestCompleteStore = keepOrStrip(plans.cheapestCompleteStore);
  const closestStore = keepOrStrip(plans.closestStore);
  const multiStore =
    plans.multiStore == null
      ? null
      : claimSlot()
        ? plans.multiStore
        : { ...plans.multiStore, lines: [] };
  // multiStore lines are a different (smaller) shape and already carry only
  // routing data, so they need no field pruning.
  return { bestSingleStore, cheapestCompleteStore, closestStore, multiStore };
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
    result.closestStore,
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
        ...trimAlternativePlanLines(plans),
        items: toSummaryItems(itemStatuses),
        location: result.location,
        assumptions: toSummaryAssumptions(result.assumptions),
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
          plans.closestStore?.storeId,
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
          plans.closestStore?.storeId,
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
