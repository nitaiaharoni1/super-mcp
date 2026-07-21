import { randomUUID } from "node:crypto";
import { AppError } from "@super-mcp/shared";
import { resolveRadiusKm } from "../../lib/defaults.js";
import { applyLocationOriginHonesty } from "../../lib/locationInput.js";
import {
  resolveStoreLocation,
  type StoreLocationMetadata,
} from "../../lib/resolveStoreLocation.js";
import { toSearchLocationParams } from "../search/locationScope.js";
import type { StoreSummary } from "../stores/index.js";
import { enrichCommodityCoverage } from "./commodityCoverage.js";
import {
  applyBasketAnswers,
  createBasketContinuationPayload,
  decodeBasketContinuation,
  encodeBasketContinuation,
} from "./continuation.js";
import { DEFAULT_STORES_LIMIT } from "./constants.js";
import { loadBasketPricingData, loadCandidateAvailability } from "./loadPricingData.js";
import { getResolution, putResolution } from "./resolutionCache.js";
import { priceStoreBasket } from "./priceStoreBasket.js";
import {
  DEFAULT_QUESTION_OPTIONS_LIMIT,
  buildBasketQuestions,
  collectQuestionOptionProductIds,
  selectQuestionCandidateShortlist,
} from "./questionAvailability.js";
import { buildRecommendationPlans } from "./recommendationPlans.js";
import { DEFAULT_DISTANCE_PENALTY_PER_KM } from "./recommendStores.js";
import { resolveItems } from "./resolve.js";
import { applyStorePlanSubstitutions } from "./substitutions.js";
import type {
  BasketContinuationV1,
  BasketInitialInput,
  BasketItemStatus,
  BasketLocationInput,
  BasketOptimizeOptions,
  BasketOptimizeRequest,
  BasketOptimizeResult,
  BasketResumeInput,
  BasketStoreResult,
  CandidateAvailability,
  ResolvedItem,
  ResolutionStatus,
} from "./types.js";

export interface ResolvedBasketLines {
  resolvedItems: ResolvedItem[];
  itemStatuses: BasketItemStatus[];
  candidateStores: StoreSummary[];
  storeIds: string[];
  location: StoreLocationMetadata;
}

function isResumeRequest(request: BasketOptimizeRequest): request is BasketResumeInput {
  return "continuation" in request;
}

function assertBasketInput(input: BasketLocationInput & { items: BasketInitialInput["items"] }): void {
  if (input.items.length === 0) {
    throw new AppError("bad_request", "items must contain at least one entry", 400);
  }
  if (!input.city && !input.near) {
    throw new AppError(
      "bad_request",
      "a location is required: provide 'city', 'near' (lat,lng), or 'location' (free text)",
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

/** Shared resolve path — location scope + resolve. */
export async function resolveBasketLines(
  input: BasketLocationInput & { items: BasketInitialInput["items"] },
  reuse?: Map<number, ResolvedItem>,
): Promise<ResolvedBasketLines> {
  assertBasketInput(input);

  const radiusKm = resolveRadiusKm(input.near, input.radiusKm);
  const locationResult = await resolveStoreLocation({
    city: input.city,
    near: input.near,
    radiusKm,
  });
  const location = applyLocationOriginHonesty(
    locationResult.location,
    input.locationOrigin,
  );
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
    reuse,
  );

  return {
    resolvedItems,
    itemStatuses: buildItemStatuses(resolvedItems),
    candidateStores,
    storeIds,
    location,
  };
}

function serializeQuestionStatuses(
  items: BasketItemStatus[],
  input: BasketInitialInput,
  availability: Map<string, CandidateAvailability>,
): BasketItemStatus[] {
  return items.map((item) => ({
    ...item,
    candidates:
      item.resolutionStatus === "resolved"
        ? []
        : selectQuestionCandidateShortlist(
            item.candidates,
            DEFAULT_QUESTION_OPTIONS_LIMIT,
            availability,
            input.items[item.index]?.query?.trim() ?? "",
          ),
  }));
}

function trimStoreResults(
  storeResults: BasketStoreResult[],
  storesLimit: number | undefined,
  verbose: boolean | undefined,
  recommendedIds: Array<string | undefined>,
): { stores: BasketStoreResult[]; storesTruncated: boolean } {
  const limit =
    storesLimit === 0 ? storeResults.length : Math.max(1, storesLimit ?? DEFAULT_STORES_LIMIT);
  const trimmed = storeResults.slice(0, limit);
  const keep = new Set(recommendedIds.filter((id): id is string => Boolean(id)));
  const stores =
    verbose ?? false
      ? trimmed
      : trimmed.map((s) => (keep.has(s.storeId) ? s : { ...s, lines: [] }));
  return { stores, storesTruncated: storeResults.length > trimmed.length };
}

interface BasketPhaseTimings {
  searchMs: number;
  classificationMs: number;
  availabilityMs: number;
  equivalenceMs: number;
  pricingMs: number;
}

function emitBasketOptimizeTelemetry(fields: {
  protocolState: "initial" | "resume";
  requestedLines: number;
  resolvedLines: number;
  confirmedLines: number;
  unresolvedLines: number;
  pricedLines: number;
  questionCount: number;
  candidateStoreCount: number;
  timings: BasketPhaseTimings;
  totalMs: number;
  bestSingleStoreCoverage: number | null;
  continuationBytes: number;
}): void {
  console.log(
    JSON.stringify({
      event: "basket_optimize",
      protocolState: fields.protocolState,
      requestedLines: fields.requestedLines,
      resolvedLines: fields.resolvedLines,
      confirmedLines: fields.confirmedLines,
      unresolvedLines: fields.unresolvedLines,
      pricedLines: fields.pricedLines,
      questionCount: fields.questionCount,
      candidateStoreCount: fields.candidateStoreCount,
      searchMs: fields.timings.searchMs,
      classificationMs: fields.timings.classificationMs,
      availabilityMs: fields.timings.availabilityMs,
      equivalenceMs: fields.timings.equivalenceMs,
      pricingMs: fields.timings.pricingMs,
      dbQueryCount: null,
      totalMs: fields.totalMs,
      bestSingleStoreCoverage: fields.bestSingleStoreCoverage,
      continuationBytes: fields.continuationBytes,
    }),
  );
}

/**
 * Build the resume reuse map: the initial call's resolved lines for every index
 * that was NOT questioned (answered lines must be re-resolved against the chosen
 * product_id + intent). A cache miss (restart/eviction/expiry) yields undefined →
 * full re-resolve, which is correct, just slower.
 */
function buildResumeReuse(
  payload: BasketContinuationV1,
  now: number | undefined,
): Map<number, ResolvedItem> | undefined {
  if (!payload.resolutionKey) return undefined;
  const cached = getResolution(payload.resolutionKey, now);
  if (!cached) return undefined;
  const answered = new Set(payload.questions.map((q) => q.itemIndex));
  const reuse = new Map<number, ResolvedItem>();
  cached.forEach((item, index) => {
    if (!answered.has(index)) reuse.set(index, item);
  });
  return reuse;
}

export async function optimizeBasket(
  request: BasketOptimizeRequest,
  options: BasketOptimizeOptions,
): Promise<BasketOptimizeResult> {
  if (isResumeRequest(request)) {
    const payload = decodeBasketContinuation(
      request.continuation,
      options.continuationSecret,
      options.now,
    );
    const input = applyBasketAnswers(payload, request.answers);
    const reuse = buildResumeReuse(payload, options.now);
    return optimizeInitialOrResumedBasket(input, options, "resume", reuse);
  }
  return optimizeInitialOrResumedBasket(request, options, "initial");
}

async function optimizeInitialOrResumedBasket(
  input: BasketInitialInput,
  options: BasketOptimizeOptions,
  protocolState: "initial" | "resume",
  reuse?: Map<number, ResolvedItem>,
): Promise<BasketOptimizeResult> {
  const startedAt = Date.now();
  const timings: BasketPhaseTimings = {
    searchMs: 0,
    classificationMs: 0,
    availabilityMs: 0,
    equivalenceMs: 0,
    pricingMs: 0,
  };

  const searchStarted = Date.now();
  const { resolvedItems, itemStatuses, candidateStores, storeIds, location } =
    await resolveBasketLines(input, reuse);
  timings.searchMs = Date.now() - searchStarted;

  const availabilityStarted = Date.now();
  const availability = await loadCandidateAvailability(
    collectQuestionOptionProductIds(itemStatuses),
    storeIds,
  );
  timings.availabilityMs = Date.now() - availabilityStarted;
  const questions = buildBasketQuestions(
    input.items,
    itemStatuses,
    availability,
    DEFAULT_QUESTION_OPTIONS_LIMIT,
  );

  const resolvedLines = itemStatuses.filter((item) => item.resolutionStatus === "resolved").length;
  const confirmedLines = itemStatuses.filter(
    (item) => item.resolutionStatus === "needs_confirmation",
  ).length;
  const unresolvedLines = itemStatuses.filter((item) => item.resolutionStatus === "unresolved")
    .length;

  if (questions.length > 0) {
    // Snapshot this call's resolved lines so the resume can reuse the lines that
    // weren't questioned instead of re-searching them. Pure performance: the key
    // is frozen into the signed continuation and a miss falls back to re-resolve.
    const resolutionKey = randomUUID();
    putResolution(resolutionKey, resolvedItems, options.now);
    const payload = createBasketContinuationPayload(
      input,
      questions.map((question) => ({
        itemIndex: question.itemIndex,
        selectionEffect: question.selectionEffect,
        allowedProductIds: question.options.map((option) => option.productId),
      })),
      options.now,
      resolutionKey,
    );
    const continuation = encodeBasketContinuation(payload, options.continuationSecret);
    emitBasketOptimizeTelemetry({
      protocolState,
      requestedLines: input.items.length,
      resolvedLines,
      confirmedLines,
      unresolvedLines,
      pricedLines: 0,
      questionCount: questions.length,
      candidateStoreCount: candidateStores.length,
      timings,
      totalMs: Date.now() - startedAt,
      bestSingleStoreCoverage: null,
      continuationBytes: Buffer.byteLength(continuation, "utf8"),
    });
    return {
      status: "needs_confirmation",
      continuation,
      questions,
      preview: {
        priceScope: "resolved_subset",
        resolvedLines,
        requestedLines: input.items.length,
        candidateStores: candidateStores.length,
      },
      items: serializeQuestionStatuses(itemStatuses, input, availability),
      location,
    };
  }

  const equivalenceStarted = Date.now();
  await enrichCommodityCoverage(input.items, resolvedItems, storeIds);
  timings.equivalenceMs = Date.now() - equivalenceStarted;

  const productIds = collectProductIdsForPricing(resolvedItems);
  if (productIds.length === 0 || candidateStores.length === 0) {
    emitBasketOptimizeTelemetry({
      protocolState,
      requestedLines: input.items.length,
      resolvedLines,
      confirmedLines,
      unresolvedLines,
      pricedLines: 0,
      questionCount: 0,
      candidateStoreCount: candidateStores.length,
      timings,
      totalMs: Date.now() - startedAt,
      bestSingleStoreCoverage: null,
      continuationBytes: 0,
    });
    return {
      status: "complete",
      bestSingleStore: null,
      cheapestCompleteStore: null,
      multiStore: null,
      items: itemStatuses.map((s) => ({ ...s, candidates: [] })),
      stores: [],
      storesCompared: 0,
      storesTruncated: false,
      location,
      assumptions: [],
    };
  }

  const pricingStarted = Date.now();
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

  const plans = buildRecommendationPlans(
    storeResults,
    resolvedItems,
    {
      distancePenaltyPerKm: input.distancePenaltyPerKm ?? DEFAULT_DISTANCE_PENALTY_PER_KM,
      distanceReliable: location.distanceReliable,
    },
    input.items.length,
  );
  timings.pricingMs = Date.now() - pricingStarted;

  if (plans.bestSingleStoreResult) {
    applyStorePlanSubstitutions(itemStatuses, plans.bestSingleStoreResult);
  }

  const { stores, storesTruncated } = trimStoreResults(
    storeResults,
    input.storesLimit,
    input.verbose,
    [plans.bestSingleStore?.storeId, plans.cheapestCompleteStore?.storeId],
  );

  const verbose = input.verbose ?? false;
  const items = verbose ? itemStatuses : itemStatuses.map((s) => ({ ...s, candidates: [] }));

  // Avoid duplicating the same store's line payload when coverage is already complete.
  let cheapestCompleteStore = plans.cheapestCompleteStore;
  if (
    !verbose &&
    cheapestCompleteStore &&
    plans.bestSingleStore &&
    cheapestCompleteStore.storeId === plans.bestSingleStore.storeId
  ) {
    cheapestCompleteStore = { ...cheapestCompleteStore, lines: [] };
  }

  emitBasketOptimizeTelemetry({
    protocolState,
    requestedLines: input.items.length,
    resolvedLines,
    confirmedLines,
    unresolvedLines,
    pricedLines: plans.bestSingleStore?.pricedLines ?? 0,
    questionCount: 0,
    candidateStoreCount: candidateStores.length,
    timings,
    totalMs: Date.now() - startedAt,
    bestSingleStoreCoverage: plans.bestSingleStore?.coverageRatio ?? null,
    continuationBytes: 0,
  });

  return {
    status: "complete",
    bestSingleStore: plans.bestSingleStore,
    cheapestCompleteStore,
    multiStore: plans.multiStore,
    items,
    stores,
    storesCompared: storeResults.length,
    storesTruncated,
    location,
    assumptions: [],
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

export function collectProductIdsForPricing(resolvedItems: ResolvedItem[]): string[] {
  return [
    ...new Set(
      resolvedItems
        .filter((r) => isSafelyResolvedForPricing(r))
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
