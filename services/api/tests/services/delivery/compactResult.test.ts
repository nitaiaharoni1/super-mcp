import { describe, expect, it } from "vitest";
import {
  DELIVERY_SUMMARY_MAX_PLAN_LINES,
  projectDeliveryResult,
} from "../../../src/services/delivery/compactResult.js";
import type {
  DeliveryOptimizeCompleteResult,
  DeliveryPlan,
  UnavailableStorefront,
} from "../../../src/services/delivery/types.js";
import type { BasketItemStatus, BasketLine } from "../../../src/services/basket/types.js";

/**
 * `optimize_delivery` shipped without the `response_detail` control the physical
 * surface has had since it hit the same wall, so every storefront returned its
 * full line breakdown whether or not the answer pointed at it.
 *
 * Measured on the twelve-line Tel Aviv basket that prompted this: 122,889 bytes
 * across twelve storefronts, ~38k tokens. A client that cannot inline a result
 * that size writes it to a file and greps it back apart, which is several model
 * round-trips before one number reaches the shopper — the tool did not feel
 * slow because it was slow, it felt slow because its answer was unreadable.
 *
 * These tests pin what summary drops and, just as importantly, what it must NOT
 * drop: every scalar the ranking is read from, and `substitutionReason` on the
 * lines that survive.
 */

function line(over: Partial<BasketLine> = {}): BasketLine {
  return {
    itemIndex: 0,
    productId: "p-1",
    name: "מי קוקוס 8-9% כחול סו שף 400 מל",
    qty: 1,
    qtyMode: "packs",
    listingId: "listing-1",
    itemCode: "7290000000001",
    unitPrice: 7.4,
    lineTotal: 7.4,
    sizeQty: 400,
    sizeUnit: "ml",
    normalizedUnitPrice: 1.85,
    normalizedUnitBasis: "per_100ml",
    promoApplied: false,
    promoDescription: null,
    clubOnly: false,
    couponOnly: false,
    substituted: true,
    substitutionReason:
      'class_fallback: this chain lists no product named like "מי קוקוס", so priced ' +
      '"פרוט&ווג\' תפוז גזר 350 מ"ל" on category and variant alone. Worth confirming.',
    originalProductId: "p-original",
    link: "https://example.test/item/7290000000001",
    freshness: { sourceTs: "2026-08-04T06:04:24.000Z", ingestedAt: "2026-08-07T21:04:22.411Z" },
    ...over,
  };
}

function plan(over: Partial<DeliveryPlan> = {}): DeliveryPlan {
  return {
    serviceSlug: "rami-levy-online",
    brand: "רמי לוי אונליין",
    serviceType: "delivery",
    marketplace: null,
    storefrontUrl: "https://www.rami-levy.co.il/he/online",
    chainId: "7290058140886",
    chainName: "רמי לוי",
    storeId: "store-1",
    currency: "ILS",
    itemsSubtotal: 274,
    itemsComparableSubtotal: 274,
    totalScope: "complete_basket",
    deliveryFee: 35.9,
    assumedDeliveryFee: null,
    deliveryFeeIsFloor: false,
    serviceFee: 0,
    deliveredTotal: 309.9,
    deliveredComparableTotal: 309.9,
    deliveryTerms: {
      confidence: "verified",
      verifiedAt: "2026-08-02",
      sourceUrl: "https://www.rami-levy.co.il/he/orders-and-deliveries",
      stale: false,
    },
    meetsMinimum: true,
    minimumOrder: null,
    amountToMinimum: null,
    minimumKnown: true,
    requiresMembership: null,
    coverage: { serves: true, matchedScope: "city", confidence: "verified", reason: null },
    freeDeliveryThreshold: null,
    nextFeeBreak: null,
    pricedLines: 12,
    resolvableLines: 12,
    requestedLines: 12,
    coverageRatio: 1,
    imputedTotal: 0,
    imputedLines: 0,
    clubOnlyLines: 0,
    couponOnlyLines: 0,
    priceFeedAsOf: "2026-08-06T16:04:56.000Z",
    priceFeedStale: false,
    lines: [line()],
    missingItems: [],
    ...over,
  };
}

function itemStatus(over: Partial<BasketItemStatus> = {}): BasketItemStatus {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: "p-1",
    name: "מי קוקוס",
    resolved: true,
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 0.95,
    lowConfidence: false,
    candidates: [],
    substitution: null,
    ...over,
  } as BasketItemStatus;
}

const RECOMMENDED = "rami-levy-online";
const OTHER = "shufersal-online";

function result(over: Partial<DeliveryOptimizeCompleteResult> = {}): DeliveryOptimizeCompleteResult {
  const recommended = plan();
  const { lines: _l, missingItems: _m, ...asSummary } = recommended;
  return {
    status: "complete",
    currency: "ILS",
    address: {
      requested: "מנדלסון 1, תל אביב",
      city: "תל אביב",
      lat: 32.08,
      lng: 34.77,
      precision: "street",
      warning: null,
    },
    preference: "cheapest",
    slotType: "standard",
    cheapestDelivered: asSummary,
    bestVerifiedTerms: asSummary,
    bestSingleOrder: asSummary,
    plans: [
      recommended,
      plan({
        serviceSlug: OTHER,
        brand: "שופרסל ONLINE",
        pricedLines: 10,
        deliveredComparableTotal: 327.3,
        lines: [line({ productId: "p-2" }), line({ itemIndex: 1, productId: "p-3" })],
        missingItems: [
          { itemIndex: 3, productId: "p-9", name: "פיירי קפסולות למדיח", reason: "not_carried_by_chain" },
        ],
      }),
    ],
    unavailableStores: [],
    items: [itemStatus()],
    assumptions: [
      {
        itemIndex: 11,
        query: "מי קוקוס",
        selectedProductId: "p-1",
        selectedName: "מי קוקוס 8-9% כחול סו שף 400 מל",
        reason: "commodity_best_effort",
        message: 'Assumed "מי קוקוס 8-9% כחול סו שף 400 מל" for "מי קוקוס".',
      },
    ],
    storefrontsCompared: 2,
    notes: [],
    ...over,
  };
}

function planBySlug(res: DeliveryOptimizeCompleteResult, slug: string): DeliveryPlan {
  const found = res.plans.find((p) => p.serviceSlug === slug);
  if (!found) throw new Error(`no plan for ${slug}`);
  return found;
}

describe("projectDeliveryResult", () => {
  it("returns standard and debug untouched", () => {
    const input = result();
    expect(projectDeliveryResult(input, "standard")).toBe(input);
    expect(projectDeliveryResult(input, "debug")).toBe(input);
  });

  it("keeps lines for the storefronts the recommendations name, and strips the rest", () => {
    const out = projectDeliveryResult(result(), "summary");
    expect(planBySlug(out, RECOMMENDED).lines).toHaveLength(1);
    expect(planBySlug(out, OTHER).lines).toEqual([]);
  });

  it("keeps every ranking scalar on a stripped plan", () => {
    const out = projectDeliveryResult(result(), "summary");
    const stripped = planBySlug(out, OTHER);
    // The whole point of stripping only `lines`: a caller must still be able to
    // rank, compare, and explain coverage without a second call.
    expect(stripped.deliveredComparableTotal).toBe(327.3);
    expect(stripped.deliveryFee).toBe(35.9);
    expect(stripped.pricedLines).toBe(10);
    expect(stripped.requestedLines).toBe(12);
    expect(stripped.meetsMinimum).toBe(true);
    expect(stripped.deliveryTerms.confidence).toBe("verified");
    expect(stripped.coverage.serves).toBe(true);
  });

  it("keeps substitutionReason on the lines it keeps", () => {
    // The delivery-specific divergence from the physical surface's summary, and
    // the reason it earns its bytes: `substituted: true` says a swap happened,
    // and only this field says the swap was `class_fallback` — matched on
    // category alone — which is what separates "this chain's own brand of
    // toothpaste" from "carrot juice for coconut water".
    const kept = planBySlug(projectDeliveryResult(result(), "summary"), RECOMMENDED).lines[0]!;
    expect(kept.substituted).toBe(true);
    expect(kept.substitutionReason).toContain("class_fallback");
  });

  it("drops the row identifiers a caller cannot act on", () => {
    const kept = planBySlug(projectDeliveryResult(result(), "summary"), RECOMMENDED).lines[0]!;
    expect(kept.listingId).toBe("");
    expect(kept.itemCode).toBe("");
    expect(kept.originalProductId).toBeNull();
    // The link already encodes the barcode, so it has to survive.
    expect(kept.link).toBe("https://example.test/item/7290000000001");
  });

  it("drops missingItems only on plans whose lines went too", () => {
    const missing = [
      { itemIndex: 3, productId: "p-9", name: "פיירי", reason: "not_carried_by_chain" as const },
    ];
    const input = result();
    input.plans[0]!.missingItems = missing;
    const out = projectDeliveryResult(input, "summary");
    expect(planBySlug(out, RECOMMENDED).missingItems).toEqual(missing);
    expect(planBySlug(out, OTHER).missingItems).toEqual([]);
  });

  it("keeps lines for every distinct storefront the three recommendations name", () => {
    const input = result();
    const other = planBySlug(input, OTHER);
    const { lines: _l, missingItems: _m, ...otherSummary } = other;
    input.bestSingleOrder = otherSummary;
    const out = projectDeliveryResult(input, "summary");
    expect(planBySlug(out, RECOMMENDED).lines).toHaveLength(1);
    expect(planBySlug(out, OTHER).lines).toHaveLength(2);
  });

  it("still shows one breakdown when nothing is orderable and there is no recommendation", () => {
    // Every storefront under its minimum: all three recommendations are null,
    // and stripping on recommendation alone would leave a shopper deciding
    // whether to top up with no idea what they would be topping up towards.
    const input = result({
      cheapestDelivered: null,
      bestVerifiedTerms: null,
      bestSingleOrder: null,
    });
    const out = projectDeliveryResult(input, "summary");
    expect(planBySlug(out, RECOMMENDED).lines).toHaveLength(1);
    expect(planBySlug(out, OTHER).lines).toEqual([]);
  });

  it("truncates a pathological line count rather than returning it unbounded", () => {
    const many = Array.from({ length: DELIVERY_SUMMARY_MAX_PLAN_LINES + 5 }, (_, i) =>
      line({ itemIndex: i, productId: `p-${i}` }),
    );
    const input = result();
    input.plans[0]!.lines = many;
    const out = planBySlug(projectDeliveryResult(input, "summary"), RECOMMENDED);
    expect(out.lines).toHaveLength(DELIVERY_SUMMARY_MAX_PLAN_LINES);
    // Never silent, and the true count still readable.
    expect(out.linesTruncated).toBe(true);
    expect(out.pricedLines).toBe(12);
  });

  it("drops the constant unavailable detail but keeps the per-storefront one", () => {
    const stores: UnavailableStorefront[] = [
      {
        serviceSlug: "yohananof-online",
        brand: "יוחננוף",
        chainName: "יוחננוף",
        reason: "outside_service_area",
        detail: "this address is not in the published delivery area",
        amountToMinimum: null,
      },
      {
        serviceSlug: "keshet-online",
        brand: "קשת טעמים אונליין",
        chainName: "קשת טעמים",
        reason: "below_minimum_order",
        detail: "basket is ₪82.40 below this storefront's ₪350.00 minimum",
        amountToMinimum: 82.4,
      },
    ];
    const out = projectDeliveryResult(result({ unavailableStores: stores }), "summary");
    expect(out.unavailableStores[0]!.detail).toBeNull();
    // The reason enum still answers "why is this chain missing".
    expect(out.unavailableStores[0]!.reason).toBe("outside_service_area");
    expect(out.unavailableStores[0]!.brand).toBe("יוחננוף");
    // The only detail built per storefront, and the only place the minimum
    // itself appears as a figure — UnavailableStorefront has no minimumOrder.
    expect(out.unavailableStores[1]!.detail).toContain("₪350.00");
    expect(out.unavailableStores[1]!.amountToMinimum).toBe(82.4);
  });

  it("drops scoring internals from items and the restated assumption message", () => {
    const out = projectDeliveryResult(result(), "summary");
    const item = out.items[0]! as Record<string, unknown>;
    expect(item).not.toHaveProperty("confidence");
    expect(item).not.toHaveProperty("candidates");
    // What actually happened to each requested thing has to survive.
    expect(item.name).toBe("מי קוקוס");
    expect(item.resolutionStatus).toBe("resolved");

    const assumption = out.assumptions[0]! as Record<string, unknown>;
    expect(assumption).not.toHaveProperty("message");
    expect(assumption.query).toBe("מי קוקוס");
    expect(assumption.reason).toBe("commodity_best_effort");
    expect(assumption.selectedName).toBe("מי קוקוס 8-9% כחול סו שף 400 מל");
  });
});
