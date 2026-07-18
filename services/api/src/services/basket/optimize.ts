import { AppError, DEFAULT_SEMANTIC_SEARCH_CONFIG } from "@super-mcp/shared";
import { resolveRadiusKm } from "../../lib/defaults.js";
import {
  resolveStoreLocation,
  type StoreLocationMetadata,
} from "../../lib/resolveStoreLocation.js";
import { toSearchLocationParams } from "../search/locationScope.js";
import { getActiveOntology } from "../search/ontology.js";
import type { StoreSummary } from "../stores/index.js";
import { DEFAULT_STORES_LIMIT } from "./constants.js";
import { loadBasketPricingData } from "./loadPricingData.js";
import { DEFAULT_PREPARE_OPTIONS_LIMIT, buildPrepareQuestions } from "./prepare.js";
import { buildCheapestRecommendation, priceStoreBasket } from "./priceStoreBasket.js";
import { resolveItems } from "./resolve.js";
import { applyCheapestStoreSubstitutions, buildMultiStorePlan } from "./substitutions.js";
import type {
  BasketCompleteness,
  BasketItemStatus,
  BasketLocationInput,
  BasketOptimizeInput,
  BasketOptimizeResult,
  BasketRecommendation,
  BasketStoreResult,
  ResolvedItem,
  ResolutionStatus,
} from "./types.js";

export interface ResolvedBasketLines {
  resolvedItems: ResolvedItem[];
  itemStatuses: BasketItemStatus[];
  completeness: BasketCompleteness;
  candidateStores: StoreSummary[];
  storeIds: string[];
  location: StoreLocationMetadata;
}

function assertBasketInput(input: BasketLocationInput & { items: BasketOptimizeInput["items"] }): void {
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
}

export function buildItemStatuses(resolvedItems: ResolvedItem[]): BasketItemStatus[] {
  return resolvedItems.map((r) => ({
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
}

/** Shared resolve path for prepare and optimize — location scope, resolve, completeness. */
export async function resolveBasketLines(
  input: BasketLocationInput & { items: BasketOptimizeInput["items"] },
): Promise<ResolvedBasketLines> {
  assertBasketInput(input);

  const radiusKm = resolveRadiusKm(input.near, input.radiusKm);
  const locationResult = await resolveStoreLocation({
    city: input.city,
    near: input.near,
    radiusKm,
  });
  const candidateStores = locationResult.stores;
  const storeIds = candidateStores.map((s) => s.id);

  const resolvedItems = await resolveItems(
    input.items,
    toSearchLocationParams({
      city: input.city,
      near: input.near,
      radiusKm,
      storeIds: storeIds.length > 0 ? storeIds : undefined,
    }),
  );
  const itemStatuses = buildItemStatuses(resolvedItems);

  const ontology = await getActiveOntology();
  const minSafeResolutionRatio =
    ontology?.searchConfig?.minSafeResolutionRatio ?? DEFAULT_SEMANTIC_SEARCH_CONFIG.minSafeResolutionRatio;
  const completeness = computeBasketCompleteness(resolvedItems, minSafeResolutionRatio);

  return {
    resolvedItems,
    itemStatuses,
    completeness,
    candidateStores,
    storeIds,
    location: locationResult.location,
  };
}

export async function optimizeBasket(input: BasketOptimizeInput): Promise<BasketOptimizeResult> {
  const { resolvedItems, itemStatuses, completeness, candidateStores, storeIds, location } =
    await resolveBasketLines(input);

  const productIds = collectProductIdsForPricing(resolvedItems);

  if (productIds.length === 0 || candidateStores.length === 0) {
    return emptyBasketResult(input.items, itemStatuses, completeness, location);
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

  // One-shot: always price the safely-resolved subset. completeness.totalsArePartial
  // stays as the honesty flag, but recommendations are no longer nulled — the lines
  // that still need a human decision are returned inline as `questions`.
  const top = storeResults[0];
  const cheapest: BasketRecommendation | null = top ? buildCheapestRecommendation(top) : null;

  if (top) {
    applyCheapestStoreSubstitutions(itemStatuses, top);
  }

  const multiStore = buildMultiStorePlan(resolvedItems, storeResults);

  const questions = buildPrepareQuestions(input.items, itemStatuses, DEFAULT_PREPARE_OPTIONS_LIMIT);

  return {
    items: itemStatuses,
    stores: trimmed,
    storesCompared: storeResults.length,
    storesTruncated: storeResults.length > trimmed.length,
    cheapest,
    multiStore,
    completeness,
    questions,
    location,
  };
}

export function classifyResolutionLine(item: ResolvedItem): ResolutionStatus {
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

export function collectProductIdsForPricing(resolvedItems: ResolvedItem[]): string[] {
  return [
    ...new Set(
      resolvedItems
        .filter((r) => isSafelyResolvedForPricing(r))
        // Equivalents' ids too, so each chain's interchangeable SKU gets its
        // listings/prices fetched for per-chain pricing.
        .flatMap((r) => [
          ...(r.productId != null ? [r.productId] : []),
          ...(r.equivalents ?? []).map((c) => c.productId),
        ]),
    ),
  ];
}

function isSafelyResolvedForPricing(item: ResolvedItem): boolean {
  return item.resolutionStatus === "resolved" || (item.productId != null && !item.lowConfidence);
}

function emptyBasketResult(
  inputItems: BasketOptimizeInput["items"],
  itemStatuses: BasketItemStatus[],
  completeness: BasketCompleteness,
  location: StoreLocationMetadata,
): BasketOptimizeResult {
  return {
    items: itemStatuses,
    stores: [],
    storesCompared: 0,
    storesTruncated: false,
    cheapest: null,
    multiStore: null,
    completeness,
    questions: buildPrepareQuestions(inputItems, itemStatuses, DEFAULT_PREPARE_OPTIONS_LIMIT),
    location,
  };
}
