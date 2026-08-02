import { describe, expect, it } from "vitest";
import type { FulfillmentServiceRow } from "@super-mcp/db";
import {
  ASSUMED_DELIVERY_FEE,
  buildDeliveryPlan,
  rankPlans,
  termsProvenance,
  unfinishedBasketPenalty,
} from "../../../src/services/delivery/planStorefronts.js";
import { partitionByCoverage } from "../../../src/services/delivery/optimizeDelivery.js";
import {
  memberRates,
  publicFeeFrom,
} from "../../../src/services/delivery/deliveryOptions.js";
import type { BasketStoreResult, ComparableCost } from "../../../src/services/basket/types.js";
import type { DeliveryPlan } from "../../../src/services/delivery/types.js";

const NOW = new Date("2026-08-01T00:00:00Z");

function service(over: Partial<FulfillmentServiceRow> = {}): FulfillmentServiceRow {
  return {
    id: "svc-1",
    slug: "shufersal-online",
    brand: "שופרסל ONLINE",
    serviceType: "delivery",
    marketplace: null,
    storefrontUrl: "https://www.shufersal.co.il/online",
    chainId: "7290027600007",
    chainName: "שופרסל",
    storeId: "store-1",
    storeName: "שופרסל ONLINE",
    minimumOrder: null,
    minimumOrderKnown: true,
    serviceFee: null,
    currency: "ILS",
    termsConfidence: "verified",
    termsVerifiedAt: new Date("2026-07-20T00:00:00Z"),
    termsSourceUrl: "https://www.shufersal.co.il/online/he/regu-online",
    notes: null,
    tariffs: [{ slotType: "standard", minSubtotal: null, maxSubtotal: null, fee: 35.9, membership: null }],
    coverage: [{ scope: "national", confidence: "reported" }],
    ...over,
  };
}

function priced(over: Partial<BasketStoreResult> = {}): BasketStoreResult {
  return {
    storeId: "store-1",
    storeName: "שופרסל ONLINE",
    chainId: "7290027600007",
    chainName: "שופרסל",
    city: null,
    address: null,
    distanceKm: null,
    distanceAccuracy: "unknown",
    storeKind: "online",
    currency: "ILS",
    total: 200,
    itemsFound: 2,
    itemsRequested: 2,
    lines: [
      { itemIndex: 0, unitPrice: 60, qty: 2, lineTotal: 100 },
      { itemIndex: 1, unitPrice: 100, qty: 1, lineTotal: 100 },
    ] as unknown as BasketStoreResult["lines"],
    missingItems: [],
    ...over,
  };
}

const costs = (comparableTotal: number, imputedLines = 0): Map<string, ComparableCost> =>
  new Map([
    [
      "store-1",
      { comparableTotal, imputedTotal: 0, imputedLines, clubOnlyLines: 0, couponOnlyLines: 0 },
    ],
  ]);

const servesNationally = {
  serves: true as const,
  matchedScope: "national" as const,
  confidence: "reported" as const,
  reason: null,
};

function plan(over: Partial<Parameters<typeof buildDeliveryPlan>[0]> = {}): DeliveryPlan {
  return buildDeliveryPlan({
    service: service(),
    priced: priced(),
    comparableCosts: costs(200),
    coverage: servesNationally,
    resolvableLines: 2,
    requestedLines: 2,
    slotType: "standard",
    memberships: [],
    preDiscountSubtotal: 220,
    now: NOW,
    ...over,
  });
}

describe("a delivered plan totals the whole order, not the goods", () => {
  it("adds the delivery fee to the item subtotal", () => {
    const result = plan();
    expect(result.itemsSubtotal).toBe(200);
    expect(result.deliveryFee).toBe(35.9);
    expect(result.deliveredTotal).toBe(235.9);
  });

  it("charges a marketplace service fee on the pre-discount total", () => {
    // Wolt: 5% capped at ₪5.90, and its own terms say discounts do not count.
    const result = plan({
      service: service({ serviceFee: { percent: 5, min: 1, max: 5.9 }, tariffs: [
        { slotType: "standard", minSubtotal: null, maxSubtotal: null, fee: 10, membership: null },
      ] }),
      preDiscountSubtotal: 100,
    });
    expect(result.serviceFee).toBe(5);
    expect(result.deliveredTotal).toBe(215);
  });
});

describe("a fee we do not know is never reported as a fee", () => {
  it("returns null and flags the confidence when no tariff exists", () => {
    const result = plan({ service: service({ tariffs: [], termsConfidence: "estimated" }) });
    expect(result.deliveryFee).toBeNull();
    expect(result.deliveredTotal).toBeNull();
    expect(result.deliveryTerms.confidence).toBe("unknown");
  });

  it("still ranks it, using a stated assumption", () => {
    // Dropping unpriced storefronts would hide Carrefour Online, whose items run
    // ~8% under its own shelves — exactly the option worth surfacing.
    const result = plan({ service: service({ tariffs: [] }) });
    expect(result.assumedDeliveryFee).toBe(ASSUMED_DELIVERY_FEE);
    expect(result.deliveredComparableTotal).toBe(200 + ASSUMED_DELIVERY_FEE);
  });

  it("stops quoting a figure nobody has re-read this quarter", () => {
    // The observed failure: a fee that sat at ₪29.90 for fifteen years, then moved
    // 20% in a month. A stale row parses fine and is simply wrong.
    const result = plan({
      service: service({ termsVerifiedAt: new Date("2026-01-01T00:00:00Z") }),
    });
    expect(result.deliveryTerms.stale).toBe(true);
    expect(result.deliveryTerms.confidence).toBe("unknown");
    expect(result.deliveryFee).toBeNull();
    expect(result.assumedDeliveryFee).toBe(ASSUMED_DELIVERY_FEE);
  });

  it("keeps quoting a figure checked inside the window", () => {
    expect(plan().deliveryTerms).toMatchObject({ stale: false, confidence: "verified" });
  });
});

describe("a minimum order is eligibility, not a penalty", () => {
  it("marks a basket below the minimum unorderable and states the shortfall", () => {
    const result = plan({
      service: service({ minimumOrder: 300 }),
      priced: priced({ total: 200 }),
    });
    expect(result.meetsMinimum).toBe(false);
    expect(result.amountToMinimum).toBe(100);
  });

  it("does not fold the shortfall into the price", () => {
    // Folding it in would let a below-minimum storefront win on cost, which is
    // recommending an order that cannot be placed.
    const result = plan({ service: service({ minimumOrder: 300 }) });
    expect(result.deliveredTotal).toBe(235.9);
  });
});

describe("reaching a cheaper tier", () => {
  it("reports a top-up worth making", () => {
    const result = plan({
      service: service({
        tariffs: [
          { slotType: "standard", minSubtotal: null, maxSubtotal: 250, fee: 29.9, membership: null },
          { slotType: "standard", minSubtotal: 250, maxSubtotal: null, fee: 0, membership: null },
        ],
      }),
    });
    expect(result.freeDeliveryThreshold).toBe(250);
    expect(result.nextFeeBreak).toMatchObject({ gap: 50, saving: 29.9, worthTopUp: false });
  });

  it("says nothing about a fee break when the terms are not trustworthy", () => {
    const result = plan({
      service: service({
        termsVerifiedAt: new Date("2026-01-01T00:00:00Z"),
        tariffs: [
          { slotType: "standard", minSubtotal: null, maxSubtotal: 210, fee: 29.9, membership: null },
          { slotType: "standard", minSubtotal: 210, maxSubtotal: null, fee: 0, membership: null },
        ],
      }),
    });
    expect(result.nextFeeBreak).toBeNull();
  });
});

describe("ranking", () => {
  const withCost = (over: Partial<DeliveryPlan>): DeliveryPlan =>
    ({ ...plan(), ...over }) as DeliveryPlan;

  it("cheapest takes the lowest delivered figure outright", () => {
    const ranked = rankPlans(
      [
        withCost({ serviceSlug: "verified", deliveredComparableTotal: 250 }),
        withCost({
          serviceSlug: "unknown-fee",
          deliveredComparableTotal: 245,
          deliveryTerms: { confidence: "unknown", verifiedAt: null, sourceUrl: null, stale: false },
        }),
      ],
      "cheapest",
    );
    expect(ranked[0]?.serviceSlug).toBe("unknown-fee");
  });

  it("balanced does not hand a close win to a fee we invented", () => {
    // A ₪5 modelled saving is not worth recommending a storefront whose real fee
    // might be ₪10 or ₪45 — and the shopper cannot see that risk in the number.
    const ranked = rankPlans(
      [
        withCost({ serviceSlug: "verified", deliveredComparableTotal: 250 }),
        withCost({
          serviceSlug: "unknown-fee",
          deliveredComparableTotal: 245,
          deliveryTerms: { confidence: "unknown", verifiedAt: null, sourceUrl: null, stale: false },
        }),
      ],
      "balanced",
    );
    expect(ranked[0]?.serviceSlug).toBe("verified");
  });

  it("balanced still yields to a genuinely large saving", () => {
    const ranked = rankPlans(
      [
        withCost({ serviceSlug: "verified", deliveredComparableTotal: 250 }),
        withCost({
          serviceSlug: "unknown-fee",
          deliveredComparableTotal: 180,
          deliveryTerms: { confidence: "unknown", verifiedAt: null, sourceUrl: null, stale: false },
        }),
      ],
      "balanced",
    );
    expect(ranked[0]?.serviceSlug).toBe("unknown-fee");
  });

  it("charges a second delivery fee for a basket the storefront cannot finish", () => {
    // The physical surface guesses ₪20 for a second trip. Online the same cost has
    // a published price, so use it.
    expect(unfinishedBasketPenalty(0)).toBe(0);
    expect(unfinishedBasketPenalty(3)).toBe(ASSUMED_DELIVERY_FEE);
  });
});

describe("coverage decides who is even a candidate", () => {
  const telAviv = { city: "תל אביב", lat: 32.0754, lng: 34.7749 };

  it("keeps a storefront that serves the address", () => {
    const { serving, unavailable } = partitionByCoverage([service()], telAviv, "standard");
    expect(serving).toHaveLength(1);
    expect(unavailable).toHaveLength(0);
  });

  it("returns a storefront that does not serve it, with the reason", () => {
    // An empty list is not an answer. "Tiv Taam's Beer Sheva depot does not reach
    // Tel Aviv" is.
    const beerShevaDepot = service({
      slug: "tiv-taam-515",
      coverage: [
        { scope: "radius", centerLat: 31.2518, centerLng: 34.7913, radiusKm: 30, confidence: "estimated" },
      ],
    });
    const { serving, unavailable } = partitionByCoverage([beerShevaDepot], telAviv, "standard");
    expect(serving).toHaveLength(0);
    expect(unavailable[0]).toMatchObject({
      serviceSlug: "tiv-taam-515",
      reason: "outside_service_area",
    });
  });

  it("distinguishes a vague address from a refusal", () => {
    const depot = service({
      coverage: [
        { scope: "radius", centerLat: 31.2518, centerLng: 34.7913, radiusKm: 30, confidence: "estimated" },
      ],
    });
    const { unavailable } = partitionByCoverage([depot], { city: "תל אביב" }, "standard");
    expect(unavailable[0]?.reason).toBe("address_too_vague");
  });

  it("offers only storefronts that actually do click-and-collect", () => {
    const noPickup = service({ slug: "rami-levy-online" });
    const withPickup = service({
      slug: "shufersal-online",
      tariffs: [
        { slotType: "standard", minSubtotal: null, maxSubtotal: null, fee: 35.9, membership: null },
        { slotType: "pickup", minSubtotal: null, maxSubtotal: null, fee: 15, membership: null },
      ],
    });
    const { serving } = partitionByCoverage([noPickup, withPickup], telAviv, "pickup");
    expect(serving.map((s) => s.service.slug)).toEqual(["shufersal-online"]);
  });
});

describe("terms provenance", () => {
  it("reports the source and date behind a quoted fee", () => {
    expect(termsProvenance(service(), true, NOW)).toEqual({
      confidence: "verified",
      verifiedAt: "2026-07-20",
      sourceUrl: "https://www.shufersal.co.il/online/he/regu-online",
      stale: false,
    });
  });

  it("is unknown when nothing was ever recorded", () => {
    expect(termsProvenance(service({ termsVerifiedAt: null }), false, NOW)).toMatchObject({
      confidence: "unknown",
      verifiedAt: null,
    });
  });
});

describe("the advertised fee is the one anyone can get", () => {
  const bands = [
    { slotType: "standard", minSubtotal: null, maxSubtotal: null, fee: 35.9, membership: null },
    { slotType: "standard", minSubtotal: null, maxSubtotal: null, fee: 29.9, membership: "credit_card" },
    { slotType: "pickup", minSubtotal: null, maxSubtotal: null, fee: 15, membership: null },
  ];

  it("does not advertise a card-holder rate as the price", () => {
    // Rami Levy's credit-card holders kept ₪29.90 when the public rate rose to
    // ₪35.90. A plain minimum over the bands quotes the member rate to everyone —
    // the same error as quoting a clubOnly shelf price, in the headline field.
    expect(publicFeeFrom(bands)).toBe(35.9);
  });

  it("still surfaces the member rate, with its condition named", () => {
    expect(memberRates(bands)).toEqual([
      { membership: "credit_card", fee: 29.9, minSubtotal: null },
    ]);
  });

  it("does not let a pickup band undercut the delivery fee", () => {
    // Pickup is ₪15 and delivery is ₪35.90; reporting ₪15 as the delivery fee
    // would promise a price that requires the shopper to drive there.
    expect(publicFeeFrom(bands)).not.toBe(15);
  });

  it("reports no fee at all rather than zero when nothing is published", () => {
    expect(publicFeeFrom([])).toBeNull();
  });
});

describe("a fee that is only a floor is not a price", () => {
  const woltish = service({
    slug: "keshet-wolt-beer-sheva",
    serviceType: "marketplace",
    marketplace: "wolt",
    tariffs: [
      {
        slotType: "standard",
        minSubtotal: null,
        maxSubtotal: null,
        fee: 10,
        membership: null,
        feeIsFloor: true,
      },
    ],
  });

  it("flags it so callers say 'from ₪10' rather than '₪10'", () => {
    // Wolt publishes only the zero-distance base and sets the real fee at
    // checkout from the courier route, so ₪10 is the best case and never the
    // worst. Presented as an ordinary flat fee it is a confidently understated
    // total, which is the failure the confidence machinery exists to prevent.
    const result = plan({ service: woltish });
    expect(result.deliveryFee).toBe(10);
    expect(result.deliveryFeeIsFloor).toBe(true);
  });

  it("leaves an ordinary flat fee unflagged", () => {
    expect(plan().deliveryFeeIsFloor).toBe(false);
  });

  it("does not flag a fee that is not being quoted at all", () => {
    expect(plan({ service: service({ tariffs: [] }) }).deliveryFeeIsFloor).toBe(false);
  });
});

describe("only a figure with a named source may be quoted", () => {
  it("withholds an estimated fee instead of trusting the caller to hedge", () => {
    // The schema says an estimated figure "must never be presented to a shopper
    // as the price". Returning the number and a label relies on the reader
    // noticing; returning null does not.
    const result = plan({ service: service({ termsConfidence: "estimated" }) });
    expect(result.deliveryFee).toBeNull();
    expect(result.assumedDeliveryFee).toBe(ASSUMED_DELIVERY_FEE);
  });

  it("quotes a reported figure, which does name a source", () => {
    expect(plan({ service: service({ termsConfidence: "reported" }) }).deliveryFee).toBe(35.9);
  });

  it("lets a stale minimum order lapse with the rest of the terms", () => {
    // The minimum comes off the same page as the fee. Declaring an order
    // unplaceable on a number nobody has rechecked in six months is the worse
    // direction to be wrong in.
    const result = plan({
      service: service({
        minimumOrder: 300,
        termsVerifiedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      priced: priced({ total: 200 }),
    });
    expect(result.meetsMinimum).toBe(true);
    expect(result.minimumKnown).toBe(false);
  });

  it("still enforces a minimum that is current", () => {
    const result = plan({
      service: service({ minimumOrder: 300 }),
      priced: priced({ total: 200 }),
    });
    expect(result.meetsMinimum).toBe(false);
  });
});

describe("no pickup option is a reason, not a disappearance", () => {
  it("reports a delivery-only storefront when pickup was asked for", () => {
    const deliveryOnly = service({ slug: "rami-levy-online" });
    const { serving, unavailable } = partitionByCoverage(
      [deliveryOnly],
      { city: "תל אביב", lat: 32.0754, lng: 34.7749 },
      "pickup",
    );
    expect(serving).toHaveLength(0);
    expect(unavailable[0]).toMatchObject({
      serviceSlug: "rami-levy-online",
      reason: "no_pickup_option",
    });
  });
});

describe("what the shopper asked for is the denominator", () => {
  it("does not call a partly-filled basket complete", () => {
    // totalScope measured against resolvableLines, which drops every line search
    // could not match at all. So a basket of six items where one resolved
    // reported complete_basket on a plan pricing exactly that one, and both
    // prose surfaces make this field THE partial-coverage signal.
    const partial = plan({ resolvableLines: 1, requestedLines: 6 });
    expect(partial.pricedLines).toBeLessThan(6);
    expect(partial.totalScope).toBe("priced_lines_only");
  });

  it("still calls a fully priced basket complete", () => {
    const full = plan({ resolvableLines: 2, requestedLines: 2 });
    expect(full.pricedLines).toBe(2);
    expect(full.totalScope).toBe("complete_basket");
  });
});
