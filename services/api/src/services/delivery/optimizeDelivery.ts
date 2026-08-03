import { listFulfillmentServices, type FulfillmentServiceRow } from "@super-mcp/db";
import {
  AppError,
  canonicalizeCity,
  centroidForCity,
  extractCityFromLocation,
} from "@super-mcp/shared";
import { enrichCommodityCoverage } from "../basket/commodityCoverage.js";
import { buildComparableCosts } from "../basket/comparableBasket.js";
import {
  createBasketContinuationPayload,
  decodeBasketContinuation,
  encodeBasketContinuation,
} from "../basket/continuation.js";
import { applyBasketAnswers } from "../basket/continuation.js";
import { loadBasketPricingData, loadCandidateAvailability } from "../basket/loadPricingData.js";
import { buildItemStatuses, collectProductIdsForPricing } from "../basket/optimize.js";
import { priceStoreBasket } from "../basket/priceStoreBasket.js";
import {
  DEFAULT_QUESTION_OPTIONS_LIMIT,
  buildBasketQuestions,
  collectAvailabilityProductIds,
  selectQuestionCandidateShortlist,
} from "../basket/questionAvailability.js";
import { resolveItems } from "../basket/resolve.js";
import { applyFastResolutionPolicy } from "../basket/resolutionPolicy.js";
import { getActiveOntology } from "../search/ontology.js";
import type {
  BasketAssumption,
  BasketCandidate,
  BasketItemStatus,
  BasketStoreResult,
  ResolvedItem,
} from "../basket/types.js";
import { listStores, type StoreSummary } from "../stores/index.js";
import {
  buildDeliveryPlan,
  coverageReport,
  STALE_PRICE_DAYS,
  bestSingleOrderPlan,
  modelledShare,
  rankPlans,
  rankPlansForResponse,
  unavailableFor,
} from "./planStorefronts.js";
import type {
  DeliveryOptimizeCompleteResult,
  DeliveryOptimizeInput,
  DeliveryOptimizeRequest,
  DeliveryOptimizeResult,
  DeliveryPlan,
  DeliveryPlanSummary,
  DeliveryPreference,
  InStoreComparison,
  UnavailableStorefront,
} from "./types.js";

export interface DeliveryOptimizeOptions {
  continuationSecret: string;
  now?: number;
}

export const DEFAULT_DELIVERY_PREFERENCE: DeliveryPreference = "balanced";

/** Nearby branches sampled for the in-store comparison. Enough to find a floor. */
const IN_STORE_COMPARISON_RADIUS_KM = 8;

function isResume(request: DeliveryOptimizeRequest): request is {
  continuation: string;
  answers: Array<{ itemIndex: number; productId: string }>;
} {
  return "continuation" in request && typeof request.continuation === "string";
}

function assertInput(input: DeliveryOptimizeInput): void {
  if (!input.items || input.items.length === 0) {
    throw new AppError("bad_request", "items must not be empty", 400);
  }
  if (!input.address && !input.city && !input.near) {
    throw new AppError(
      "bad_request",
      "a delivery destination is required: address, city, or near",
      400,
    );
  }
}

/**
 * The point AND the town, because coverage is published both ways.
 *
 * The physical surface deliberately refuses to turn a free-text location into a
 * city filter: a branch two streets over the municipal boundary is still the
 * nearest shop, and filtering by town would hide it. Delivery is the opposite
 * case. Rami Levy and Carrefour publish their service areas as lists of named
 * settlements, so the town IS the rule, and dropping it means a `city`-scope rule
 * can never be tested and every such storefront reports "address too vague".
 *
 * It also survives a geocoder outage. Nominatim rate-limits, and when it does the
 * point falls back to a city centroid — at which moment the town parsed out of
 * "מנדלסון 1, תל אביב" is the only usable signal left.
 */
function resolveDestination(input: DeliveryOptimizeInput): {
  city: string | null;
  lat: number | null;
  lng: number | null;
} {
  const fromField = input.city ? (canonicalizeCity(input.city) ?? input.city) : null;
  const fromAddress = input.address ? extractCityFromLocation(input.address) : null;
  const city = fromField ?? (fromAddress ? (canonicalizeCity(fromAddress) ?? fromAddress) : null);
  // A radius or polygon rule needs a point. Without one every regional depot
  // reports "address too vague", so a shopper in Beer Sheva who typed only their
  // town would not be offered the Beer Sheva depot. The centroid is coarse, and
  // `address.precision` says so.
  const point = input.near ?? (city ? centroidForCity(city) : null);
  return { city, lat: point?.lat ?? null, lng: point?.lng ?? null };
}

/**
 * Storefronts that will deliver here, and why the rest will not.
 *
 * This replaces the physical surface's radius query entirely. There is no
 * "nearest storefront": a service either covers the address or it does not, and
 * the ones that do not are returned with a reason rather than dropped, because
 * "Carrefour does not deliver to Tel Aviv" is an answer and an empty list is not.
 */
export function partitionByCoverage(
  services: readonly FulfillmentServiceRow[],
  destination: { city?: string | null; lat?: number | null; lng?: number | null },
  slotType: string,
): {
  serving: Array<{ service: FulfillmentServiceRow; coverage: ReturnType<typeof coverageReport> }>;
  unavailable: UnavailableStorefront[];
} {
  const serving: Array<{
    service: FulfillmentServiceRow;
    coverage: ReturnType<typeof coverageReport>;
  }> = [];
  const unavailable: UnavailableStorefront[] = [];

  for (const service of services) {
    // A pickup slot is only meaningful at a service that offers pickup bands.
    // Reported rather than skipped: the surface promises that a storefront which
    // cannot serve the request comes back with a reason, and "Rami Levy has no
    // click-and-collect" is a reason worth stating.
    if (slotType === "pickup" && !service.tariffs.some((t) => t.slotType === "pickup")) {
      unavailable.push(
        unavailableFor(service, "no_pickup_option", "this storefront delivers only, no click-and-collect"),
      );
      continue;
    }
    // Same treatment for express, which was accepted by the schema and then
    // matched no tariff band anywhere. Every storefront came back with a null
    // fee and confidence "unknown", so the answer read as "we do not know what
    // express costs" when the truth is that nobody in the catalogue offers it.
    if (slotType === "express" && !service.tariffs.some((t) => t.slotType === "express")) {
      unavailable.push(
        unavailableFor(service, "no_express_option", "this storefront publishes no express slot"),
      );
      continue;
    }
    const coverage = coverageReport(service, destination);
    if (coverage.serves) {
      serving.push({ service, coverage });
      continue;
    }
    unavailable.push(
      unavailableFor(
        service,
        coverage.reason ?? "coverage_unknown",
        coverage.reason === "outside_service_area"
          ? "this address is not in the published delivery area"
          : coverage.reason === "address_too_vague"
            ? "a street address is needed to test this service area"
            : "no service area recorded for this storefront",
      ),
    );
  }
  return { serving, unavailable };
}

/**
 * Item total before promotions — the basis a marketplace charges its % fee on.
 *
 * `unitPrice` is the shelf price of the SKU and `lineTotal` is what the line
 * costs after any promo, so summing unitPrice x qty reconstructs the undiscounted
 * figure. Wolt's terms are explicit that this is the basis
 * ("הנחות ומבצעים לא ילקחו בחשבון בחישוב דמי התפעול"), so using the discounted
 * total would understate the fee on every basket carrying a promotion.
 */
function preDiscountTotal(priced: BasketStoreResult): number {
  const sum = priced.lines.reduce((total, line) => total + line.unitPrice * line.qty, 0);
  return sum > 0 ? sum : priced.total;
}

async function buildInStoreComparison(
  resolvedItems: ResolvedItem[],
  destination: { lat?: number | null; lng?: number | null; city?: string | null },
  bestDelivered: DeliveryPlan | null,
  includeClub: boolean,
  includeCoupon: boolean,
): Promise<InStoreComparison | null> {
  if (!bestDelivered) return null;
  const near =
    destination.lat != null && destination.lng != null
      ? { lat: destination.lat, lng: destination.lng }
      : undefined;
  if (!near && !destination.city) return null;

  const branches = await listStores({
    near,
    city: destination.city ?? undefined,
    radiusKm: near ? IN_STORE_COMPARISON_RADIUS_KM : undefined,
    shoppableOnly: true,
  });
  if (branches.length === 0) return null;

  const productIds = resolvedItems
    .map((item) => item.productId)
    .filter((id): id is string => id != null);
  if (productIds.length === 0) return null;

  const branchIds = branches.map((b) => b.id);
  const pricing = await loadBasketPricingData(productIds, branchIds, includeClub, includeCoupon);
  const priced = branches
    .map((store) =>
      priceStoreBasket(
        store,
        resolvedItems,
        pricing.listingByChainAndProduct,
        pricing.priceByListingAndStore,
        pricing.promoMap,
      ),
    )
    .filter((r): r is BasketStoreResult => r != null && r.lines.length > 0);
  if (priced.length === 0) return null;

  const costs = buildComparableCosts(priced);
  const best = priced
    .map((store) => ({
      store,
      comparableTotal: costs.get(store.storeId)?.comparableTotal ?? store.total,
    }))
    .sort((a, b) => a.comparableTotal - b.comparableTotal)[0];
  if (!best) return null;

  return {
    storeName: best.store.storeName,
    chainName: best.store.chainName,
    distanceKm: best.store.distanceKm,
    comparableTotal: Math.round(best.comparableTotal * 100) / 100,
    deliveryPremium:
      Math.round((bestDelivered.deliveredComparableTotal - best.comparableTotal) * 100) / 100,
  };
}

export async function optimizeDelivery(
  request: DeliveryOptimizeRequest,
  options: DeliveryOptimizeOptions,
): Promise<DeliveryOptimizeResult> {
  if (isResume(request)) {
    const payload = decodeBasketContinuation<DeliveryOptimizeInput>(
      request.continuation,
      options.continuationSecret,
      options.now,
    );
    const input = applyBasketAnswers(payload, request.answers);
    return runDeliveryOptimization(input, options);
  }
  return runDeliveryOptimization(request, options);
}

async function runDeliveryOptimization(
  input: DeliveryOptimizeInput,
  options: DeliveryOptimizeOptions,
): Promise<DeliveryOptimizeResult> {
  assertInput(input);

  const preference = input.preference ?? DEFAULT_DELIVERY_PREFERENCE;
  const slotType = input.slotType ?? "standard";
  const memberships = input.memberships ?? [];
  const includeClub = input.includeClub ?? true;
  const includeCoupon = input.includeCoupon ?? true;
  const now = new Date(options.now ?? Date.now());
  const notes: string[] = [];

  const destination = resolveDestination(input);

  const services = await listFulfillmentServices();
  const { serving, unavailable } = partitionByCoverage(services, destination, slotType);

  // Nothing placed this destination. `canonicalizeCity` hands back anything it
  // does not recognise, so a typo or a region name ("בקעת אונו" is a valley,
  // not a town) reaches here looking like a city and finds no centroid. The
  // national storefronts still match, because national coverage matches
  // everyone, and the surface used to hand back a priced plan and a status of
  // "complete" for an address that does not exist. Say so instead: the only
  // storefronts left are the ones that would have served any address at all.
  const placed = destination.lat != null;
  const onlyNational =
    !placed && serving.every(({ coverage }) => coverage.matchedScope === "national");
  if (onlyNational && serving.length > 0) {
    notes.push(
      `We could not place "${destination.city ?? "this address"}". The storefronts below ` +
        "deliver nationwide, so they are not evidence that anyone delivers to this " +
        "particular address. Send a fuller address, or a known city name, to get a real " +
        "coverage answer.",
    );
  }

  if (serving.length === 0) {
    return {
      status: "complete",
      currency: "ILS",
      address: describeAddress(input, destination),
      preference,
      slotType,
      cheapestDelivered: null,
      bestVerifiedTerms: null,
      bestSingleOrder: null,
      plans: [],
      unavailableStores: unavailable,
      inStoreComparison: null,
      items: [],
      assumptions: [],
      storefrontsCompared: 0,
      notes: [
        "No online storefront in our data delivers to this address. " +
          "Coverage today spans Shufersal, Rami Levy, Tiv Taam, Carrefour and Keshet; " +
          "Victory, Yochananof, Osher Ad, Hazi Hinam, Machsanei Hashuk and am:pm file no " +
          "priced online storefront in the regulated feeds.",
      ],
    };
  }

  // Resolve the basket against the online catalogues, not nearby branches. This
  // matters: Shufersal ONLINE lists 15,896 items against ~6,400 in a שלי branch,
  // so a line that resolves against branch stock can miss what the website sells.
  const servingStoreIds = serving
    .map((s) => s.service.storeId)
    .filter((id): id is string => id != null);

  const resolvedItems = await resolveItems(input.items, { storeIds: servingStoreIds });
  const itemStatuses = buildItemStatuses(resolvedItems);

  const availability = await loadCandidateAvailability(
    collectAvailabilityProductIds(itemStatuses),
    servingStoreIds,
  );
  const questions = buildBasketQuestions(
    input.items,
    itemStatuses,
    availability,
    DEFAULT_QUESTION_OPTIONS_LIMIT,
  );

  const resolutionMode = input.resolutionMode ?? "fast";
  if (resolutionMode === "strict" && questions.length > 0) {
    const payload = createBasketContinuationPayload<DeliveryOptimizeInput>(
      input,
      questions.map((q) => ({
        itemIndex: q.itemIndex,
        selectionEffect: q.selectionEffect,
        allowedProductIds: q.options.map((o) => o.productId),
      })),
      options.now,
    );
    return {
      status: "needs_confirmation",
      continuation: encodeBasketContinuation(payload, options.continuationSecret),
      questions,
      items: itemStatuses.map((item) => ({
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
      })),
      storefrontsCompared: serving.length,
    };
  }

  // Same fast policy the physical surface uses: turn a low-confidence line into a
  // priced best-effort choice and record what was assumed, rather than stopping to
  // ask. Reused verbatim — nothing about it is specific to walking into a shop,
  // ontology included: that fourth argument is what feeds hard query attributes
  // (brand, variant) into the candidate filter, and omitting it here quietly gave
  // the delivery surface a weaker resolver than the one the accuracy benchmark
  // measures.
  const ontology = await getActiveOntology();
  const fastPolicy = applyFastResolutionPolicy(
    input.items,
    resolvedItems,
    availability,
    ontology,
  );
  const pricingItems = fastPolicy.items;
  const assumptions: BasketAssumption[] = fastPolicy.assumptions;

  // Broaden each line to the SKUs these storefronts actually carry, before
  // pricing. Without it every storefront is asked for the one globally chosen
  // SKU and a chain that stocks the same commodity under its own item code
  // reports "not carried": Rami Levy online has 15,849 priced products against
  // Carrefour's 9,600 yet filled 5 lines of a 12-line basket to Carrefour's 11.
  // The physical surface has called this since the per-chain work landed; the
  // delivery surface never did.
  await enrichCommodityCoverage(input.items, pricingItems, servingStoreIds);

  // Primary AND its gated equivalents/alternatives. Collecting only the primary
  // loaded no listings for the peers, so priceStoreBasket's fallback order had
  // nothing to fall back to and the enrichment above would have been inert.
  const productIds = collectProductIdsForPricing(pricingItems);
  const pricing = await loadBasketPricingData(
    productIds,
    servingStoreIds,
    includeClub,
    includeCoupon,
  );

  // priceStoreBasket wants a StoreSummary; the storefront rows carry everything
  // it reads except the geo/coverage fields, which are meaningless for a website.
  const storeSummaries = new Map<string, StoreSummary>();
  for (const { service } of serving) {
    if (!service.storeId) continue;
    storeSummaries.set(service.storeId, {
      id: service.storeId,
      chainId: service.chainId,
      chainName: service.chainName,
      storeCode: service.slug,
      name: service.storeName ?? service.brand,
      address: service.storefrontUrl,
      city: null,
      zip: null,
      lat: null,
      lng: null,
      geoSource: null,
      storeKind: "online",
      distanceKm: null,
    });
  }

  const pricedByStore = new Map<string, BasketStoreResult>();
  for (const [storeId, summary] of storeSummaries) {
    const result = priceStoreBasket(
      summary,
      pricingItems,
      pricing.listingByChainAndProduct,
      pricing.priceByListingAndStore,
      pricing.promoMap,
    );
    if (result && result.lines.length > 0) pricedByStore.set(storeId, result);
  }

  const comparableCosts = buildComparableCosts([...pricedByStore.values()]);
  const resolvableLines = pricingItems.filter((item) => item.productId != null).length;

  const plans: DeliveryPlan[] = [];
  for (const { service, coverage } of serving) {
    if (!service.storeId) continue;
    const priced = pricedByStore.get(service.storeId);
    if (!priced) {
      unavailable.push(
        unavailableFor(
          service,
          "no_lines_priced",
          "this storefront does not list any item on the basket",
        ),
      );
      continue;
    }
    plans.push(
      buildDeliveryPlan({
        service,
        priced,
        comparableCosts,
        coverage,
        resolvableLines,
        requestedLines: input.items.length,
        slotType,
        memberships,
        preDiscountSubtotal: preDiscountTotal(priced),
        now,
      }),
    );
  }

  // Below the minimum the order cannot be placed, so it is not a candidate for
  // any recommendation — but it stays in `plans` with the flag and the shortfall,
  // because "add ₪27.50 and this becomes your cheapest option" is the most useful
  // thing we can say. It is also listed in unavailableStores, which answers the
  // different question of why it cannot be ordered as it stands.
  //
  // `plans` used to be built from `orderable` alone, so the storefront dropped out
  // of the response entirely and the shortfall survived only as prose. That hid a
  // real option: on a Tel Aviv basket, Carrefour listed 11 of 12 lines at ₪134.90
  // and vanished for being ₪65.10 short, while the storefronts left in view could
  // fill 7 and 8.
  const orderable = plans.filter((plan) => plan.meetsMinimum);
  const belowMinimum = plans.filter((plan) => !plan.meetsMinimum);
  for (const plan of plans) {
    if (plan.meetsMinimum) continue;
    unavailable.push({
      serviceSlug: plan.serviceSlug,
      brand: plan.brand,
      chainName: plan.chainName,
      reason: "below_minimum_order",
      detail: `basket is ₪${plan.amountToMinimum?.toFixed(2)} below this storefront's ₪${plan.minimumOrder?.toFixed(2)} minimum`,
      // The shortfall as a number, not only inside the sentence: plans are
      // filtered to meetsMinimum before ranking, so this is the ONLY place a
      // caller can read it.
      amountToMinimum: plan.amountToMinimum,
    });
  }

  // The recommendation fields name storefronts that `plans` already carries in
  // full, so they ship without the line arrays. Repeating them cost a quarter of
  // the response on a 12-line basket.
  const asSummary = (plan: DeliveryPlan | null): DeliveryPlanSummary | null => {
    if (!plan) return null;
    const { lines: _lines, missingItems: _missingItems, ...summary } = plan;
    return summary;
  };

  const ranked = rankPlans(orderable, preference);
  const allPlans = rankPlansForResponse(plans, preference);
  const cheapestDelivered = ranked[0] ?? null;
  const bestVerifiedTerms =
    ranked.find((plan) => plan.deliveryTerms.confidence === "verified") ?? null;
  const bestSingleOrder = bestSingleOrderPlan(orderable, preference);

  // A cheapest whose lead comes from lines it cannot sell is not a finding, and
  // saying it plainly costs nothing. Both halves of this matter: the winner's
  // total can be mostly modelled, and a rival that actually stocks more of the
  // list can be sitting right behind it.
  if (cheapestDelivered) {
    const modelled = modelledShare(cheapestDelivered);
    if (modelled >= 0.25) {
      notes.push(
        `${Math.round(modelled * 100)}% of ${cheapestDelivered.brand}'s comparable total is a ` +
          `market reference, not its own price: it lists ${cheapestDelivered.pricedLines} of ` +
          `${cheapestDelivered.requestedLines} requested lines. Treat the ranking as indicative.`,
      );
    }
    if (cheapestDelivered.stalePricedLines > 0) {
      notes.push(
        `${cheapestDelivered.stalePricedLines} of ${cheapestDelivered.pricedLines} priced lines ` +
          `at ${cheapestDelivered.brand} come from a price the retailer last published over ` +
          `${STALE_PRICE_DAYS} days ago. Per-line freshness.sourceTs says how old each one is.`,
      );
    }
    // A storefront held back only by its minimum is a live option, not a dead
    // end: the shopper decides whether topping up is worth it, and cannot decide
    // that about a storefront we never mention.
    const worthTopUp = belowMinimum
      .filter((plan) => plan.amountToMinimum != null)
      .filter(
        (plan) =>
          plan.pricedLines > cheapestDelivered.pricedLines ||
          plan.deliveredComparableTotal < cheapestDelivered.deliveredComparableTotal,
      )
      .sort((a, b) => b.pricedLines - a.pricedLines || a.amountToMinimum! - b.amountToMinimum!)[0];
    if (worthTopUp) {
      notes.push(
        `${worthTopUp.brand} lists ${worthTopUp.pricedLines} of ${worthTopUp.requestedLines} lines ` +
          `at ₪${worthTopUp.itemsSubtotal.toFixed(2)} but sits ₪${worthTopUp.amountToMinimum!.toFixed(2)} ` +
          `under its ₪${worthTopUp.minimumOrder?.toFixed(2)} minimum. It is in plans with ` +
          "meetsMinimum:false; adding that much makes it orderable.",
      );
    }
    if (bestSingleOrder && bestSingleOrder.pricedLines > cheapestDelivered.pricedLines) {
      notes.push(
        `${bestSingleOrder.brand} lists ${bestSingleOrder.pricedLines} of ` +
          `${bestSingleOrder.requestedLines} lines against ${cheapestDelivered.brand}'s ` +
          `${cheapestDelivered.pricedLines}. It is the best basket obtainable as one order.`,
      );
    }
  }

  if (cheapestDelivered?.deliveryTerms.confidence === "unknown") {
    notes.push(
      `The delivery fee for ${cheapestDelivered.brand} is not established; ` +
        `it was ranked using an assumed ₪${cheapestDelivered.assumedDeliveryFee?.toFixed(2)}. ` +
        "Check the storefront before quoting a total.",
    );
  }
  if (cheapestDelivered?.nextFeeBreak?.worthTopUp) {
    const b = cheapestDelivered.nextFeeBreak;
    notes.push(
      `Spending ₪${b.gap.toFixed(2)} more at ${cheapestDelivered.brand} drops the delivery fee ` +
        `to ₪${b.fee.toFixed(2)}, saving ₪${b.saving.toFixed(2)} net.`,
    );
  }
  const marketplace = ranked.find((plan) => plan.serviceType === "marketplace");
  if (marketplace) {
    notes.push(
      `${marketplace.brand} is a marketplace: its item prices are set above the chain's own ` +
        "shelf prices, on top of the delivery and service fees.",
    );
  }

  const inStoreComparison = input.compareInStore
    ? await buildInStoreComparison(
        pricingItems,
        destination,
        cheapestDelivered,
        includeClub,
        includeCoupon,
      )
    : null;

  return {
    status: "complete",
    currency: cheapestDelivered?.currency ?? "ILS",
    address: describeAddress(input, destination),
    preference,
    slotType,
    cheapestDelivered: asSummary(cheapestDelivered),
    bestVerifiedTerms: asSummary(bestVerifiedTerms),
    bestSingleOrder: asSummary(bestSingleOrder),
    plans: allPlans,
    unavailableStores: unavailable,
    inStoreComparison,
    // Rebuilt from the items that were actually priced, not from the pre-policy
    // snapshot. The fast policy swaps products (a bare "קוטג 5%" resolved to a
    // garlic-and-dill tub, then upgraded to the plain one every storefront
    // stocks) and fills lines that first came back unresolved, so reporting the
    // earlier statuses named one product while `plans[].lines` priced another,
    // and called an olive oil unresolved that four storefronts had quoted.
    items: buildItemStatuses(pricingItems).map((item) => ({
      ...item,
      candidates: [] as BasketCandidate[],
    })),
    assumptions,
    storefrontsCompared: plans.length,
    notes,
  };
}

function describeAddress(
  input: DeliveryOptimizeInput,
  destination: { city: string | null; lat: number | null; lng: number | null },
): DeliveryOptimizeCompleteResult["address"] {
  return {
    requested: input.address ?? null,
    city: destination.city,
    lat: destination.lat,
    lng: destination.lng,
    precision: input.locationOrigin?.precision ?? null,
    warning: input.locationOrigin?.warning ?? null,
  };
}

export type { DeliveryOptimizeCompleteResult };
