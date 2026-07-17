import { AppError, DEFAULT_SEMANTIC_SEARCH_CONFIG } from "@super-mcp/shared";
import { listStores } from "../stores/index.js";
import { resolveRadiusKm } from "../../lib/defaults.js";
import { getActiveOntology } from "../search/ontology.js";
import { DEFAULT_STORES_LIMIT } from "./constants.js";
import { loadBasketPricingData } from "./loadPricingData.js";
import { buildCheapestRecommendation, priceStoreBasket } from "./priceStoreBasket.js";
import { resolveItems } from "./resolve.js";
import { applyCheapestStoreSubstitutions, buildMultiStorePlan } from "./substitutions.js";
import type {
  BasketCompleteness,
  BasketItemStatus,
  BasketOptimizeInput,
  BasketOptimizeResult,
  BasketRecommendation,
  BasketStoreResult,
  ResolvedItem,
  ResolutionStatus,
} from "./types.js";

export async function optimizeBasket(input: BasketOptimizeInput): Promise<BasketOptimizeResult> {
  if (input.items.length === 0) {
    throw new AppError("bad_request", "items must contain at least one entry", 400);
  }
  if (!input.city && !input.near) {
    throw new AppError(
      "bad_request",
      "a location is required: provide either 'city' or 'near' (lat,lng) to scope candidate stores",
      400,
    );
  }

  // Location first: free-text resolution must prefer products priced in these stores.
  const candidateStores = await listStores({
    city: input.city,
    near: input.near,
    radiusKm: resolveRadiusKm(input.near, input.radiusKm),
  });
  const storeIds = candidateStores.map((s) => s.id);

  const resolvedItems = await resolveItems(input.items, {
    city: input.city,
    near: input.near,
    radiusKm: resolveRadiusKm(input.near, input.radiusKm),
    storeIds: storeIds.length > 0 ? storeIds : undefined,
  });
  const itemStatuses: BasketItemStatus[] = resolvedItems.map((r) => ({
    index: r.index,
    qty: r.qty,
    qtyMode: r.qtyMode,
    amount: r.amount,
    unit: r.unit,
    productId: r.productId,
    name: r.name,
    resolved: r.productId !== null,
    resolvedBy: r.resolvedBy,
    resolutionStatus: classifyResolutionLine(r),
    confidence: r.confidence,
    lowConfidence: r.lowConfidence,
    candidates: r.candidates,
    substitution: r.substitution,
  }));

  const ontology = await getActiveOntology();
  const minSafeResolutionRatio =
    ontology?.searchConfig?.minSafeResolutionRatio ?? DEFAULT_SEMANTIC_SEARCH_CONFIG.minSafeResolutionRatio;
  const completeness = computeBasketCompleteness(resolvedItems, minSafeResolutionRatio);

  // Load listings/prices for ALL candidates so each store can use the best available match.
  const productIds = collectProductIds(resolvedItems);

  if (productIds.length === 0 || candidateStores.length === 0) {
    return emptyBasketResult(itemStatuses, completeness);
  }

  const includeClub = input.includeClub ?? true;
  const { listingByChainAndProduct, priceByListingAndStore, promoMap } = await loadBasketPricingData(
    productIds,
    storeIds,
    includeClub,
  );

  const storeResults: BasketStoreResult[] = [];

  for (const store of candidateStores) {
    const result = priceStoreBasket(
      store,
      resolvedItems,
      listingByChainAndProduct,
      priceByListingAndStore,
      promoMap,
    );
    if (result) storeResults.push(result);
  }

  storeResults.sort((a, b) => {
    const missingDiff = a.missingItems.length - b.missingItems.length;
    if (missingDiff !== 0) return missingDiff;
    return a.total - b.total;
  });

  const storesLimit =
    input.storesLimit === 0
      ? storeResults.length
      : Math.max(1, input.storesLimit ?? DEFAULT_STORES_LIMIT);
  const trimmed = storeResults.slice(0, storesLimit);

  if (completeness.totalsArePartial) {
    return {
      items: itemStatuses,
      stores: trimmed,
      storesCompared: storeResults.length,
      storesTruncated: storeResults.length > trimmed.length,
      cheapest: null,
      multiStore: null,
      completeness,
    };
  }

  const top = storeResults[0];
  const cheapest: BasketRecommendation | null = top ? buildCheapestRecommendation(top) : null;

  if (top) {
    applyCheapestStoreSubstitutions(itemStatuses, top);
  }

  const multiStore = buildMultiStorePlan(resolvedItems, storeResults);

  return {
    items: itemStatuses,
    stores: trimmed,
    storesCompared: storeResults.length,
    storesTruncated: storeResults.length > trimmed.length,
    cheapest,
    multiStore,
    completeness,
  };
}

function classifyResolutionLine(item: ResolvedItem): ResolutionStatus {
  if (item.resolutionStatus === "resolved" || (item.productId != null && !item.lowConfidence)) {
    return "resolved";
  }
  if (
    item.resolutionStatus === "needs_confirmation" ||
    (item.lowConfidence && item.candidates.length > 0)
  ) {
    return "needs_confirmation";
  }
  return "unresolved";
}

export function computeBasketCompleteness(
  resolvedItems: ResolvedItem[],
  minSafeResolutionRatio: number,
): BasketCompleteness {
  const requestedLines = resolvedItems.length;
  let resolvedLines = 0;
  let needsConfirmationLines = 0;
  let unresolvedLines = 0;

  for (const item of resolvedItems) {
    const status = classifyResolutionLine(item);
    if (status === "resolved") resolvedLines += 1;
    else if (status === "needs_confirmation") needsConfirmationLines += 1;
    else unresolvedLines += 1;
  }

  const safeResolutionRatio = requestedLines > 0 ? resolvedLines / requestedLines : 0;
  const totalsArePartial = safeResolutionRatio < minSafeResolutionRatio;

  return {
    requestedLines,
    resolvedLines,
    needsConfirmationLines,
    unresolvedLines,
    safeResolutionRatio,
    totalsArePartial,
  };
}

function collectProductIds(resolvedItems: ResolvedItem[]): string[] {
  return [
    ...new Set(
      resolvedItems.flatMap((r) => {
        const ids = r.candidates.map((c) => c.productId);
        if (r.productId) ids.push(r.productId);
        return ids;
      }),
    ),
  ];
}

function emptyBasketResult(
  itemStatuses: BasketItemStatus[],
  completeness: BasketCompleteness,
): BasketOptimizeResult {
  return {
    items: itemStatuses,
    stores: [],
    storesCompared: 0,
    storesTruncated: false,
    cheapest: null,
    multiStore: null,
    completeness,
  };
}
