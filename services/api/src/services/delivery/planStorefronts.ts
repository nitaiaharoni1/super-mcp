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

const DAY_MS = 24 * 60 * 60 * 1000;

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
    totalScope: pricedLines >= input.resolvableLines ? "complete_basket" : "priced_lines_only",

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
    lines: priced.lines,
    missingItems: priced.missingItems,
  };
}

/**
 * Cost of a basket this storefront cannot finish, in shekels.
 *
 * The physical surface charges a flat ₪20 "second trip" here, an estimate of the
 * shopper's time. Online the same idea has a real published price: finishing the
 * list elsewhere means a second delivery fee, and we know what those cost. Using
 * the same assumed fee keeps the two consistent and means a storefront missing
 * lines is charged what completing the order actually costs, not a guess at
 * inconvenience.
 */
export function unfinishedBasketPenalty(imputedLines: number): number {
  return imputedLines > 0 ? ASSUMED_DELIVERY_FEE : 0;
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
    const base = plan.deliveredComparableTotal + unfinishedBasketPenalty(plan.imputedLines);
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

export function unavailableFor(
  service: FulfillmentServiceRow,
  reason: UnavailableStorefront["reason"],
  detail: string | null,
): UnavailableStorefront {
  return {
    serviceSlug: service.slug,
    brand: service.brand,
    chainName: service.chainName,
    reason,
    detail,
  };
}
