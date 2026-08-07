import {
  checkMinimumOrder,
  computeDeliveryCost,
  evaluateCoverage,
  type CoverageQuery,
} from "@super-mcp/shared";
import type { FulfillmentServiceRow } from "@super-mcp/db";
import { comparableCostFor } from "../basket/comparableBasket.js";
import type { BasketStoreResult, ComparableCost } from "../basket/types.js";
import type {
  DeliveryCoverageReport,
  DeliveryPlan,
  DeliveryTermsProvenance,
  UnavailableStorefront,
} from "./types.js";

/**
 * Ranking-only stand-in for a fee we have not established.
 *
 * The two largest chains both publish ₪35.90, verified from their own terms, so
 * that is the market's centre of gravity and the least distorting assumption
 * available: applying it to an unknown storefront ranks it as if it were an
 * ordinary chain, neither rewarded nor punished for our ignorance.
 *
 * It is NEVER reported as `deliveryFee`. That field stays null, `assumedDeliveryFee`
 * carries this number, and `deliveryTerms.confidence` says "unknown", so an agent
 * repeating the plan back to a shopper cannot turn our placeholder into a quote.
 * The alternative — dropping storefronts with unknown terms — would hide Carrefour
 * Online, whose item prices run 7.8% BELOW its own shelves and which is therefore
 * exactly the option a price-sensitive shopper wants to hear about.
 */
export const ASSUMED_DELIVERY_FEE = 35.9;

/** Days after which a hand-checked figure stops being quotable. */
export const TERMS_TTL_DAYS = 90;

/**
 * Days after which a storefront's price feed counts as stale.
 *
 * Chains republish their regulated feed daily, so nothing new for a month means
 * the feed itself has gone quiet, not that prices held steady. Thirty days is
 * loose enough not to flag ordinary weekend gaps and tight enough to catch a
 * chain that has stopped filing.
 */
export const STALE_PRICE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between a storefront's newest price data and now. */
export function priceFeedAgeDays(asOf: Date | null, now: Date): number | null {
  if (asOf == null) return null;
  const ms = now.getTime() - asOf.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

function agorot(value: number): number {
  return Math.round(value * 100) / 100;
}

export function termsProvenance(
  service: FulfillmentServiceRow,
  hasTariff: boolean,
  now: Date,
): DeliveryTermsProvenance {
  const verifiedAt = service.termsVerifiedAt;
  const stale =
    verifiedAt != null && now.getTime() - verifiedAt.getTime() > TERMS_TTL_DAYS * DAY_MS;
  return {
    // No tariff row at all, or a figure nobody has re-read this quarter: both are
    // "we do not know today's fee", and saying so beats quoting either.
    confidence: !hasTariff || stale ? "unknown" : service.termsConfidence,
    verifiedAt: verifiedAt ? verifiedAt.toISOString().slice(0, 10) : null,
    sourceUrl: service.termsSourceUrl,
    stale,
  };
}

/**
 * Whether a figure carrying this confidence may be reported as a price.
 *
 * `estimated` means a category default — a number we made up so the optimiser has
 * something to rank on. The schema says outright it "must never be presented to a
 * shopper as the price", and relying on a caller to notice a label and hedge is
 * not the same as withholding the number. Only `verified` and `reported` name a
 * real source, so only they are quotable.
 */
export function isQuotableConfidence(
  confidence: DeliveryTermsProvenance["confidence"],
): boolean {
  return confidence === "verified" || confidence === "reported";
}

export function coverageReport(
  service: FulfillmentServiceRow,
  query: CoverageQuery,
): DeliveryCoverageReport {
  const verdict = evaluateCoverage(service.coverage, query);
  if (verdict.serves) {
    return {
      serves: true,
      matchedScope: verdict.matchedScope,
      confidence: verdict.confidence,
      reason: null,
    };
  }
  return { serves: false, matchedScope: null, confidence: null, reason: verdict.reason };
}

export interface BuildPlanInput {
  service: FulfillmentServiceRow;
  priced: BasketStoreResult;
  comparableCosts: Map<string, ComparableCost>;
  coverage: DeliveryCoverageReport;
  resolvableLines: number;
  requestedLines: number;
  slotType: string;
  memberships: readonly string[];
  /** Item total before promotions — what a marketplace charges its % fee on. */
  preDiscountSubtotal: number;
  /** Newest price data this storefront's retailer has published, if known. */
  priceFeedAsOf: Date | null;
  now: Date;
}

export function buildDeliveryPlan(input: BuildPlanInput): DeliveryPlan {
  const { service, priced, coverage, slotType, memberships } = input;
  const comparable = comparableCostFor(priced, input.comparableCosts);

  const cost = computeDeliveryCost(service.tariffs, service.serviceFee, {
    subtotal: priced.total,
    preDiscountSubtotal: input.preDiscountSubtotal,
    slotType,
    memberships,
  });
  const terms = termsProvenance(service, cost.deliveryFee != null, input.now);
  // Stale or merely estimated terms are not quotable, so the plan reports no fee
  // and falls back to the assumption for ranking — the same treatment as having no
  // tariff at all.
  const quotableFee = isQuotableConfidence(terms.confidence) ? cost.deliveryFee : null;
  // A floor still ranks at its own value: it is the best case, and inflating it to
  // the assumed flat fee would understate a genuinely cheap marketplace.
  const rankingFee = quotableFee ?? ASSUMED_DELIVERY_FEE;

  // The minimum comes off the same terms page as the fee, so it decays with it.
  // An unknown minimum is treated as met (never hide a real option), which is the
  // safe direction here: a stale figure can then fail to warn, but it can never
  // declare an order unplaceable on the strength of a number nobody has rechecked.
  const minimum = checkMinimumOrder(
    terms.stale ? null : service.minimumOrder,
    service.minimumOrderKnown && !terms.stale,
    priced.total,
  );

  const pricedLines = priced.lines.length;
  return {
    serviceSlug: service.slug,
    brand: service.brand,
    serviceType: service.serviceType,
    marketplace: service.marketplace,
    storefrontUrl: service.storefrontUrl,
    chainId: service.chainId,
    chainName: service.chainName,
    storeId: priced.storeId,
    currency: priced.currency,

    itemsSubtotal: agorot(priced.total),
    itemsComparableSubtotal: comparable.comparableTotal,
    // Measured against what the SHOPPER asked for, not against how many lines
    // happened to resolve to a product.
    //
    // `resolvableLines` is computed globally and drops every line search could
    // not match at all, so a basket of six items where one resolved reported
    // `complete_basket` on a plan pricing exactly that one. Both prose surfaces
    // make this field THE partial-coverage signal, and the sibling basket
    // surface already derives it from pricedLines/requestedLines.
    totalScope: pricedLines >= input.requestedLines ? "complete_basket" : "priced_lines_only",

    deliveryFee: quotableFee,
    assumedDeliveryFee: quotableFee == null ? ASSUMED_DELIVERY_FEE : null,
    deliveryFeeIsFloor: quotableFee != null && cost.deliveryFeeIsFloor,
    serviceFee: cost.serviceFee,
    deliveredTotal:
      quotableFee == null ? null : agorot(priced.total + quotableFee + cost.serviceFee),
    deliveredComparableTotal: agorot(
      comparable.comparableTotal + rankingFee + cost.serviceFee,
    ),
    deliveryTerms: terms,

    meetsMinimum: minimum.meetsMinimum,
    minimumOrder: minimum.minimumOrder,
    amountToMinimum: minimum.amountToMinimum,
    minimumKnown: minimum.minimumKnown,
    requiresMembership: quotableFee == null ? null : cost.requiresMembership,

    coverage,

    freeDeliveryThreshold: cost.freeDeliveryThreshold,
    nextFeeBreak: terms.confidence === "unknown" ? null : cost.nextFeeBreak,

    pricedLines,
    resolvableLines: input.resolvableLines,
    requestedLines: input.requestedLines,
    coverageRatio: input.requestedLines === 0 ? 0 : pricedLines / input.requestedLines,
    imputedTotal: comparable.imputedTotal,
    imputedLines: comparable.imputedLines,
    clubOnlyLines: comparable.clubOnlyLines,
    couponOnlyLines: comparable.couponOnlyLines,
    priceFeedAsOf: input.priceFeedAsOf?.toISOString() ?? null,
    priceFeedStale: (priceFeedAgeDays(input.priceFeedAsOf, input.now) ?? 0) > STALE_PRICE_DAYS,
    lines: priced.lines,
    missingItems: priced.missingItems,
  };
}

/**
 * Cost of a basket this storefront cannot finish, in shekels.
 *
 * The physical surface charges a flat ₪20 "second trip" here, an estimate of the
 * shopper's time. Online the same idea has a real published price: finishing the
 * list elsewhere means a second delivery fee, and we know what those cost.
 *
 * The fee is prorated by the share of the basket left behind rather than charged
 * flat. Flat punished the near-complete plan hardest in relative terms: a
 * storefront missing one ₪9.90 line paid the same ₪35.90 as one missing six
 * lines, so a 12-line basket ranked a plan covering 6 lines above a plan
 * covering 11. Prorating keeps the "you will pay to finish this elsewhere"
 * signal while making it proportional to how much is actually left to buy.
 */
export function unfinishedBasketPenalty(imputedLines: number, priceableLines: number): number {
  if (imputedLines <= 0) return 0;
  if (priceableLines <= 0) return ASSUMED_DELIVERY_FEE;
  const share = Math.min(1, imputedLines / priceableLines);
  return Math.round(ASSUMED_DELIVERY_FEE * share * 100) / 100;
}

/**
 * Share of a plan's comparable total that is modelled rather than observed.
 *
 * `deliveredComparableTotal` mixes prices this storefront publishes with a
 * market reference for every line it does not. At six imputed lines out of
 * twelve that number is half fiction, and the gap between two such plans can sit
 * entirely inside the modelling error. Callers use this to decide whether a
 * "cheapest" claim is worth making at all.
 */
export function modelledShare(plan: DeliveryPlan): number {
  const total = plan.itemsComparableSubtotal;
  if (total <= 0) return 0;
  return Math.min(1, plan.imputedTotal / total);
}

/**
 * Rank orderable plans.
 *
 * `cheapest` takes the lowest delivered figure outright. `balanced` breaks close
 * calls in favour of terms we can defend: a plan whose fee we assumed might be
 * ₪10 or ₪45, and recommending it over a verified one to save ₪3 of modelled
 * money is a bad trade the shopper cannot see. The margin is one delivery fee's
 * worth of doubt, scaled down — big enough to matter, small enough that a
 * genuinely cheaper storefront still wins.
 */
export const UNVERIFIED_TERMS_MARGIN = 12;

export function rankPlans(
  plans: readonly DeliveryPlan[],
  preference: "cheapest" | "balanced",
): DeliveryPlan[] {
  const cost = (plan: DeliveryPlan): number => {
    const base =
      plan.deliveredComparableTotal +
      unfinishedBasketPenalty(plan.imputedLines, plan.pricedLines + plan.imputedLines);
    if (preference === "cheapest") return base;
    return plan.deliveryTerms.confidence === "unknown" ? base + UNVERIFIED_TERMS_MARGIN : base;
  };
  return [...plans].sort(
    (a, b) =>
      cost(a) - cost(b) ||
      b.pricedLines - a.pricedLines ||
      a.serviceSlug.localeCompare(b.serviceSlug),
  );
}

/**
 * Every plan, orderable ones first, each group ranked.
 *
 * A storefront under its minimum is not a candidate for any recommendation, but
 * dropping it from the response hid a real option: on a Tel Aviv basket,
 * Carrefour listed 11 of 12 lines at ₪134.90 and disappeared for being ₪65.10
 * short, while the storefronts still on screen could fill 7 and 8. Whether that
 * top-up is worth it is the shopper's call, and they cannot make it about a
 * storefront nobody mentioned. Orderable plans stay first so `plans[0]` is never
 * an order that cannot be placed.
 */
export function rankPlansForResponse(
  plans: readonly DeliveryPlan[],
  preference: "cheapest" | "balanced",
): DeliveryPlan[] {
  return [
    ...rankPlans(plans.filter((plan) => plan.meetsMinimum), preference),
    ...rankPlans(plans.filter((plan) => !plan.meetsMinimum), preference),
  ];
}

/**
 * The plan a shopper can actually place as ONE order, best coverage first.
 *
 * `rankPlans` answers "cheapest once we model the gaps away", which is the right
 * question only if the shopper is willing to place a second order somewhere else.
 * Someone asking for a basket to be delivered usually is not: they want the list
 * to arrive. This is the delivery twin of the physical surface's coverage-first
 * `bestNearby`, and it breaks coverage ties on the same cost function so the
 * cheaper of two equally complete storefronts still wins.
 */
export function bestSingleOrderPlan(
  plans: readonly DeliveryPlan[],
  preference: "cheapest" | "balanced",
): DeliveryPlan | null {
  if (plans.length === 0) return null;
  const ranked = rankPlans(plans, preference);
  let best = ranked[0]!;
  for (const plan of ranked) {
    if (plan.pricedLines > best.pricedLines) best = plan;
  }
  return best;
}

export function unavailableFor(
  service: FulfillmentServiceRow,
  reason: UnavailableStorefront["reason"],
  detail: string | null,
  amountToMinimum: number | null = null,
): UnavailableStorefront {
  return {
    serviceSlug: service.slug,
    brand: service.brand,
    chainName: service.chainName,
    reason,
    detail,
    amountToMinimum,
  };
}
