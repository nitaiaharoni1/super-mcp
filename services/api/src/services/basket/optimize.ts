import { randomUUID } from "node:crypto";
import { AppError } from "@super-mcp/shared";
import { resolveRadiusKm } from "../../lib/defaults.js";
import {
  applyLocationOriginHonesty,
  deriveGeocodeTelemetryStrategy,
  type GeocodeTelemetryStrategy,
} from "../../lib/locationInput.js";
import {
  resolveStoreLocation,
  type StoreLocationMetadata,
} from "../../lib/resolveStoreLocation.js";
import { toSearchLocationParams } from "../search/locationScope.js";
import { getActiveOntology } from "../search/ontology.js";
import type { StoreSummary } from "../stores/index.js";
import { projectBasketResult, resolveResponseDetail } from "./compactResult.js";
import { enrichCommodityCoverage } from "./commodityCoverage.js";
import {
  applyBasketAnswers,
  createBasketContinuationPayload,
  decodeBasketContinuation,
  encodeBasketContinuation,
} from "./continuation.js";
import { DEFAULT_STORES_LIMIT } from "./constants.js";
import { selectSignalStores } from "./signalStores.js";
import { loadBasketPricingData, loadCandidateAvailability } from "./loadPricingData.js";
import { priceStoreBasket } from "./priceStoreBasket.js";
import { getResolution, putResolution } from "./resolutionCache.js";
import { applyFastResolutionPolicy } from "./resolutionPolicy.js";
import {
  DEFAULT_QUESTION_OPTIONS_LIMIT,
  buildBasketQuestions,
  collectAvailabilityProductIds,
  selectQuestionCandidateShortlist,
} from "./questionAvailability.js";
import { buildRecommendationPlans } from "./recommendationPlans.js";
import {
  DEFAULT_BASKET_PREFERENCE,
  distancePenaltyForPreference,
  effectiveCost,
  type RecommendationOptions,
} from "./recommendStores.js";
import { resolveItems } from "./resolve.js";
import { applyStorePlanSubstitutions } from "./substitutions.js";
import type {
  BasketAssumption,
  BasketContinuationV1,
  BasketInitialInput,
  BasketItemStatus,
  BasketLocationInput,
  BasketNeedsConfirmationResult,
  BasketOptimizeOptions,
  BasketOptimizeRequest,
  BasketOptimizeResult,
  BasketPhaseTimings,
  BasketPreference,
  BasketResolutionMode,
  BasketResponseDetail,
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
  /** Every eligible store — the pricing scope. */
  storeIds: string[];
  /**
   * Nearest-N subset used for resolution signals (search scope, availability,
   * coverage). See RESOLUTION_SIGNAL_STORE_SAMPLE.
   */
  signalStoreIds: string[];
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
    // Online / pickup / warehouse rows hold the three deepest price catalogs in
    // the feed. They are not places to shop, so they must never enter pricing —
    // keeping them out here also keeps `storesCompared` honest.
    shoppableOnly: true,
  });
  const location = applyLocationOriginHonesty(
    locationResult.location,
    input.locationOrigin,
  );
  const candidateStores = locationResult.stores;
  const storeIds = candidateStores.map((s) => s.id);
  // Chain-diverse, nearest-first. A plain nearest-N slice silently dropped whole
  // chains from the coverage-peer query, which made every branch of those chains
  // report not_carried_by_chain. See selectSignalStores.
  const signalStoreIds = selectSignalStores(candidateStores);

  const resolvedItems = await resolveItems(
    input.items,
    toSearchLocationParams({
      city: input.city,
      near: input.near,
      radiusKm,
      storeIds: signalStoreIds.length > 0 ? signalStoreIds : undefined,
      // This surface can only sell what a branch stocks. Without it, products
      // that exist solely online win candidate slots on name score and are then
      // carried through class equivalence and pricing before being dropped for
      // having no branch price.
      branchStockedOnly: true,
    }),
    reuse,
  );

  return {
    resolvedItems,
    itemStatuses: buildItemStatuses(resolvedItems),
    candidateStores,
    storeIds,
    signalStoreIds,
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

function limitStoreResults(
  storeResults: BasketStoreResult[],
  storesLimit: number | undefined,
): { stores: BasketStoreResult[]; storesTruncated: boolean } {
  const limit =
    storesLimit === 0 ? storeResults.length : Math.max(1, storesLimit ?? DEFAULT_STORES_LIMIT);
  const stores = storeResults.slice(0, limit);
  return { stores, storesTruncated: storeResults.length > stores.length };
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
  geocodeMs: number;
  geocodeStrategy: GeocodeTelemetryStrategy;
  resolutionMode: BasketResolutionMode;
  responseDetail: BasketResponseDetail;
  responseBytes: number;
  /** Which travel-vs-price trade-off the caller asked for. */
  preference: BasketPreference;
  /**
   * Same-basket total of the recommended store, and how much of it was imputed.
   * Without these we cannot tell in production whether a cheap-looking answer is
   * observed or estimated.
   */
  bestComparableTotal: number | null;
  bestImputedLines: number | null;
  /** Conditional-price exposure of the recommended store. */
  bestClubOnlyLines: number | null;
  bestCouponOnlyLines: number | null;
}): void {
  // Benchmarks/canaries may set SUPER_MCP_BASKET_TELEMETRY=0 for clean stdout JSON.
  if (process.env.SUPER_MCP_BASKET_TELEMETRY === "0") return;
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
      // Geocode is boundary-measured and excluded from basket phase sums.
      geocodeMs: fields.geocodeMs,
      geocodeStrategy: fields.geocodeStrategy,
      resolutionMode: fields.resolutionMode,
      responseDetail: fields.responseDetail,
      preference: fields.preference,
      bestComparableTotal: fields.bestComparableTotal,
      bestImputedLines: fields.bestImputedLines,
      bestClubOnlyLines: fields.bestClubOnlyLines,
      bestCouponOnlyLines: fields.bestCouponOnlyLines,
      responseBytes: fields.responseBytes,
      dbQueryCount: null,
      totalMs: fields.totalMs,
      bestSingleStoreCoverage: fields.bestSingleStoreCoverage,
      continuationBytes: fields.continuationBytes,
    }),
  );
}

function finalizeBasketResult(args: {
  result: BasketOptimizeResult;
  responseDetail: BasketResponseDetail;
  protocolState: "initial" | "resume";
  requestedLines: number;
  resolvedLines: number;
  confirmedLines: number;
  unresolvedLines: number;
  pricedLines: number;
  questionCount: number;
  candidateStoreCount: number;
  timings: BasketPhaseTimings;
  startedAt: number;
  bestSingleStoreCoverage: number | null;
  continuationBytes: number;
  geocodeMs: number;
  geocodeStrategy: GeocodeTelemetryStrategy;
  resolutionMode: BasketResolutionMode;
  preference: BasketPreference;
  bestPlan?: {
    comparableTotal: number;
    imputedLines: number;
    clubOnlyLines: number;
    couponOnlyLines: number;
  } | null;
}): BasketOptimizeResult {
  const projected = projectBasketResult(args.result, args.responseDetail);
  const responseBytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
  emitBasketOptimizeTelemetry({
    protocolState: args.protocolState,
    requestedLines: args.requestedLines,
    resolvedLines: args.resolvedLines,
    confirmedLines: args.confirmedLines,
    unresolvedLines: args.unresolvedLines,
    pricedLines: args.pricedLines,
    questionCount: args.questionCount,
    candidateStoreCount: args.candidateStoreCount,
    timings: args.timings,
    totalMs: Date.now() - args.startedAt,
    bestSingleStoreCoverage: args.bestSingleStoreCoverage,
    continuationBytes: args.continuationBytes,
    geocodeMs: args.geocodeMs,
    geocodeStrategy: args.geocodeStrategy,
    resolutionMode: args.resolutionMode,
    responseDetail: args.responseDetail,
    responseBytes,
    preference: args.preference,
    bestComparableTotal: args.bestPlan?.comparableTotal ?? null,
    bestImputedLines: args.bestPlan?.imputedLines ?? null,
    bestClubOnlyLines: args.bestPlan?.clubOnlyLines ?? null,
    bestCouponOnlyLines: args.bestPlan?.couponOnlyLines ?? null,
  });
  return projected;
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
  const { resolvedItems, itemStatuses, candidateStores, storeIds, signalStoreIds, location } =
    await resolveBasketLines(input, reuse);
  timings.searchMs = Date.now() - searchStarted;

  const availabilityStarted = Date.now();
  // Full candidate space, not just questioned lines: the fast policy uses this
  // map to catch a line that resolved onto a SKU almost no nearby store stocks.
  const availability = await loadCandidateAvailability(
    collectAvailabilityProductIds(itemStatuses),
    signalStoreIds,
  );
  timings.availabilityMs = Date.now() - availabilityStarted;
  const questions = buildBasketQuestions(
    input.items,
    itemStatuses,
    availability,
    DEFAULT_QUESTION_OPTIONS_LIMIT,
  );

  // Public default is fast; treat missing mode as fast so one-call callers complete.
  const resolutionMode = input.resolutionMode ?? "fast";
  // Hoisted so every exit path, including the strict early return, reports it.
  const preference = input.preference ?? DEFAULT_BASKET_PREFERENCE;

  const responseDetail = resolveResponseDetail(input.responseDetail, input.verbose);
  const geocodeMs = input.geocodeMs ?? 0;
  const geocodeStrategy = deriveGeocodeTelemetryStrategy(input.locationOrigin);

  if (resolutionMode === "strict" && questions.length > 0) {
    const pending = buildNeedsConfirmationResult({
      input,
      options,
      protocolState,
      questions,
      resolvedItems,
      itemStatuses,
      availability,
      candidateStores,
      location,
      timings,
    });
    const resolvedLines = itemStatuses.filter((item) => item.resolutionStatus === "resolved")
      .length;
    const confirmedLines = itemStatuses.filter(
      (item) => item.resolutionStatus === "needs_confirmation",
    ).length;
    const unresolvedLines = itemStatuses.filter((item) => item.resolutionStatus === "unresolved")
      .length;
    return finalizeBasketResult({
      result: pending,
      responseDetail,
      protocolState,
      requestedLines: input.items.length,
      resolvedLines,
      confirmedLines,
      unresolvedLines,
      pricedLines: 0,
      questionCount: questions.length,
      candidateStoreCount: candidateStores.length,
      timings,
      startedAt,
      bestSingleStoreCoverage: null,
      continuationBytes: Buffer.byteLength(pending.continuation, "utf8"),
      geocodeMs,
      geocodeStrategy,
      resolutionMode,
      preference,
    });
  }

  // Fast mode (or strict with nothing to ask): never return needs_confirmation.
  // Ontology feeds hard query attrs (brand/variant/…) into filterSafeCandidates.
  const ontology = await getActiveOntology();
  const fastPolicy = applyFastResolutionPolicy(
    input.items,
    resolvedItems,
    availability,
    ontology,
  );
  const pricingItems = fastPolicy.items;
  const assumptions: BasketAssumption[] = fastPolicy.assumptions;
  const pricedStatuses = buildItemStatuses(pricingItems);

  const resolvedLines = pricedStatuses.filter((item) => item.resolutionStatus === "resolved").length;
  const confirmedLines = 0;
  const unresolvedLines = pricedStatuses.filter((item) => item.resolutionStatus === "unresolved")
    .length;

  const equivalenceStarted = Date.now();
  await enrichCommodityCoverage(input.items, pricingItems, signalStoreIds);
  timings.equivalenceMs = Date.now() - equivalenceStarted;

  const productIds = collectProductIdsForPricing(pricingItems);
  if (productIds.length === 0 || candidateStores.length === 0) {
    return finalizeBasketResult({
      result: {
        status: "complete",
        bestSingleStore: null,
        cheapestCompleteStore: null,
        closestStore: null,
        multiStore: null,
        items: pricedStatuses,
        stores: [],
        storesCompared: 0,
        storesTruncated: false,
        location,
        assumptions,
        timings,
      },
      responseDetail,
      protocolState,
      requestedLines: input.items.length,
      resolvedLines,
      confirmedLines,
      unresolvedLines,
      pricedLines: 0,
      questionCount: 0,
      candidateStoreCount: candidateStores.length,
      timings,
      startedAt,
      bestSingleStoreCoverage: null,
      continuationBytes: 0,
      geocodeMs,
      geocodeStrategy,
      resolutionMode,
      preference,
      bestPlan: null,
    });
  }

  const pricingStarted = Date.now();
  const includeClub = input.includeClub ?? true;
  const includeCoupon = input.includeCoupon ?? true;
  const { listingByChainAndProduct, priceByListingAndStore, promoMap } = await loadBasketPricingData(
    productIds,
    storeIds,
    includeClub,
    includeCoupon,
  );

  const storeResults: BasketStoreResult[] = [];
  for (const store of candidateStores) {
    const result = priceStoreBasket(
      store,
      pricingItems,
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

  const recommendationOptions: RecommendationOptions = {
    distancePenaltyPerKm: distancePenaltyForPreference(
      preference,
      input.distancePenaltyPerKm,
    ),
    distanceReliable: location.distanceReliable,
    preference,
  };
  const plans = buildRecommendationPlans(
    storeResults,
    pricingItems,
    recommendationOptions,
    input.items.length,
    {
      location,
      storesById: new Map(candidateStores.map((store) => [store.id, store])),
    },
  );
  const rankingOptions: RecommendationOptions = {
    ...recommendationOptions,
    comparableCosts: plans.comparableCosts,
  };
  timings.pricingMs = Date.now() - pricingStarted;

  if (plans.bestSingleStoreResult) {
    applyStorePlanSubstitutions(pricedStatuses, plans.bestSingleStoreResult);
  }

  // Order the returned sample by the SAME criterion the recommendation used, so
  // a `stores_limit` cut keeps the stores that actually competed. Sorting by raw
  // total put the least-stocked stores at the top of the list.
  const rankedStoreResults = [...storeResults].sort(
    (a, b) =>
      effectiveCost(a, rankingOptions) - effectiveCost(b, rankingOptions) ||
      b.lines.length - a.lines.length ||
      a.storeId.localeCompare(b.storeId),
  );
  const { stores, storesTruncated } = limitStoreResults(rankedStoreResults, input.storesLimit);

  return finalizeBasketResult({
    result: {
      status: "complete",
      bestSingleStore: plans.bestSingleStore,
      cheapestCompleteStore: plans.cheapestCompleteStore,
      closestStore: plans.closestStore,
      multiStore: plans.multiStore,
      items: pricedStatuses,
      stores,
      storesCompared: storeResults.length,
      storesTruncated,
      location,
      assumptions,
      timings,
    },
    responseDetail,
    protocolState,
    requestedLines: input.items.length,
    resolvedLines,
    confirmedLines,
    unresolvedLines,
    pricedLines: plans.bestSingleStore?.pricedLines ?? 0,
    questionCount: 0,
    candidateStoreCount: candidateStores.length,
    timings,
    startedAt,
    bestSingleStoreCoverage: plans.bestSingleStore?.coverageRatio ?? null,
    continuationBytes: 0,
    geocodeMs,
    geocodeStrategy,
    resolutionMode,
    preference,
    bestPlan: plans.bestSingleStore
      ? {
          comparableTotal: plans.bestSingleStore.comparableTotal,
          imputedLines: plans.bestSingleStore.imputedLines,
          clubOnlyLines: plans.bestSingleStore.clubOnlyLines,
          couponOnlyLines: plans.bestSingleStore.couponOnlyLines,
        }
      : null,
  });
}

function buildNeedsConfirmationResult(args: {
  input: BasketInitialInput;
  options: BasketOptimizeOptions;
  protocolState: "initial" | "resume";
  questions: ReturnType<typeof buildBasketQuestions>;
  resolvedItems: ResolvedItem[];
  itemStatuses: BasketItemStatus[];
  availability: Map<string, CandidateAvailability>;
  candidateStores: { length: number };
  location: StoreLocationMetadata;
  timings: BasketPhaseTimings;
}): BasketNeedsConfirmationResult {
  const {
    input,
    options,
    questions,
    resolvedItems,
    itemStatuses,
    availability,
    candidateStores,
    location,
  } = args;

  const resolvedLines = itemStatuses.filter((item) => item.resolutionStatus === "resolved").length;

  // Strict-only: snapshot resolved lines + signed continuation for resume.
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

export function classifyResolutionLine(item: ResolvedItem): ResolutionStatus {
  if (item.resolutionStatus === "resolved" || (item.productId != null && !item.lowConfidence)) {
    return "resolved";
  }
  // Honor explicit omit/unresolved from fast policy — do not re-promote to
  // needs_confirmation just because candidates remain on the line object.
  if (item.resolutionStatus === "unresolved") {
    return "unresolved";
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
