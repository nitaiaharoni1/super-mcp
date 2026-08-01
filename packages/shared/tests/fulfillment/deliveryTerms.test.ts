import { describe, expect, it } from "vitest";
import {
  checkMinimumOrder,
  computeDeliveryCost,
  computeServiceFee,
  type DeliveryTariffBand,
} from "../../src/fulfillment/deliveryTerms.js";

const band = (over: Partial<DeliveryTariffBand> = {}): DeliveryTariffBand => ({
  slotType: "standard",
  minSubtotal: null,
  maxSubtotal: null,
  fee: 0,
  membership: null,
  ...over,
});

/** Shufersal Online, verified from its own תקנון §37 on 2026-08-01. */
const SHUFERSAL_DELIVERY = [band({ fee: 35.9 })];

/** Shufersal click-and-collect, תקנון §39: ₪15, dropping to ₪10 above ₪750. */
const SHUFERSAL_PICKUP = [
  band({ slotType: "pickup", maxSubtotal: 750, fee: 15 }),
  band({ slotType: "pickup", minSubtotal: 750, fee: 10 }),
];

/** Yango Deli: free at or above ₪99, and below ₪99 there is no order at all. */
const YANGO = [band({ minSubtotal: 99, fee: 0 })];

describe("delivery fee bands", () => {
  it("charges a flat fee when the retailer publishes one", () => {
    const result = computeDeliveryCost(SHUFERSAL_DELIVERY, null, { subtotal: 240 });
    expect(result.deliveryFee).toBe(35.9);
    expect(result.totalFees).toBe(35.9);
    expect(result.nextFeeBreak).toBeNull();
    expect(result.freeDeliveryThreshold).toBeNull();
  });

  it("returns null rather than zero when no band covers the basket", () => {
    // The difference matters: a missing tariff must never be presented as free
    // delivery, which is what a 0 default would do.
    const result = computeDeliveryCost(YANGO, null, { subtotal: 40 });
    expect(result.deliveryFee).toBeNull();
    expect(result.totalFees).toBeNull();
  });

  it("picks the band the subtotal actually falls in", () => {
    expect(computeDeliveryCost(SHUFERSAL_PICKUP, null, { subtotal: 700, slotType: "pickup" }).deliveryFee).toBe(15);
    expect(computeDeliveryCost(SHUFERSAL_PICKUP, null, { subtotal: 800, slotType: "pickup" }).deliveryFee).toBe(10);
  });

  it("treats the band boundary as belonging to the cheaper tier", () => {
    // "₪10 above ₪750" reads as inclusive at ₪750 in the terms.
    expect(computeDeliveryCost(SHUFERSAL_PICKUP, null, { subtotal: 750, slotType: "pickup" }).deliveryFee).toBe(10);
  });

  it("does not leak a slot's tariff into another slot", () => {
    expect(computeDeliveryCost(SHUFERSAL_PICKUP, null, { subtotal: 700 }).deliveryFee).toBeNull();
  });
});

describe("reaching a cheaper band", () => {
  it("reports the gap to a cheaper tier and whether closing it pays", () => {
    const result = computeDeliveryCost(SHUFERSAL_PICKUP, null, {
      subtotal: 748,
      slotType: "pickup",
    });
    expect(result.nextFeeBreak).toEqual({
      atSubtotal: 750,
      fee: 10,
      gap: 2,
      saving: 5,
      worthTopUp: true,
    });
  });

  it("says so when the top-up costs more than it saves", () => {
    const result = computeDeliveryCost(SHUFERSAL_PICKUP, null, {
      subtotal: 700,
      slotType: "pickup",
    });
    expect(result.nextFeeBreak).toMatchObject({ gap: 50, saving: 5, worthTopUp: false });
  });

  it("does not call a break-even top-up worth it", () => {
    // Spending ₪10 to save ₪10 is a wash, and calling it a win pushes the shopper
    // into buying something they did not want.
    const bands = [band({ maxSubtotal: 100, fee: 10 }), band({ minSubtotal: 100, fee: 0 })];
    expect(computeDeliveryCost(bands, null, { subtotal: 90 }).nextFeeBreak).toMatchObject({
      gap: 10,
      saving: 10,
      worthTopUp: false,
    });
  });

  it("exposes a genuine free-delivery threshold separately", () => {
    const bands = [band({ maxSubtotal: 300, fee: 29.9 }), band({ minSubtotal: 300, fee: 0 })];
    const result = computeDeliveryCost(bands, null, { subtotal: 280 });
    expect(result.freeDeliveryThreshold).toBe(300);
    expect(result.nextFeeBreak).toMatchObject({ fee: 0, gap: 20, worthTopUp: true });
  });

  it("prefers the nearer of two equally cheap tiers", () => {
    const bands = [
      band({ maxSubtotal: 200, fee: 30 }),
      band({ minSubtotal: 200, maxSubtotal: 500, fee: 0 }),
      band({ minSubtotal: 500, fee: 0 }),
    ];
    expect(computeDeliveryCost(bands, null, { subtotal: 150 }).nextFeeBreak?.atSubtotal).toBe(200);
  });
});

describe("membership-conditional rates", () => {
  // Rami Levy credit-card holders kept the old rate when the public one rose to
  // ₪35.90. Quoting the member rate to someone without the card is the same error
  // as quoting a clubOnly shelf price — one layer up.
  const bands = [band({ fee: 35.9 }), band({ fee: 29.9, membership: "credit_card" })];

  it("quotes the public rate to a shopper with no membership", () => {
    const result = computeDeliveryCost(bands, null, { subtotal: 300 });
    expect(result.deliveryFee).toBe(35.9);
    expect(result.requiresMembership).toBeNull();
  });

  it("quotes the member rate and names the condition", () => {
    const result = computeDeliveryCost(bands, null, {
      subtotal: 300,
      memberships: ["credit_card"],
    });
    expect(result.deliveryFee).toBe(29.9);
    expect(result.requiresMembership).toBe("credit_card");
  });
});

describe("marketplace service fee", () => {
  // Wolt's דמי תפעול, verified live from its own venue payload on 2026-08-01:
  // 5% of the item total, floored at ₪1.00 and capped at ₪5.90.
  const WOLT = { percent: 5, min: 1, max: 5.9 };

  it("applies the floor on a small basket", () => {
    expect(computeServiceFee(WOLT, 15)).toBe(1);
  });

  it("applies the percentage in the middle of the range", () => {
    expect(computeServiceFee(WOLT, 80)).toBe(4);
  });

  it("applies the cap on a large basket", () => {
    expect(computeServiceFee(WOLT, 400)).toBe(5.9);
  });

  it("charges on the pre-discount total, as Wolt's own terms state", () => {
    // "הנחות ומבצעים לא ילקחו בחשבון בחישוב דמי התפעול" — using the discounted
    // subtotal would understate the bill on every basket carrying a promotion.
    const result = computeDeliveryCost([band({ fee: 10 })], WOLT, {
      subtotal: 60,
      preDiscountSubtotal: 100,
    });
    expect(result.serviceFee).toBe(5);
    expect(result.totalFees).toBe(15);
  });

  it("adds nothing for a chain that charges no service fee", () => {
    expect(computeDeliveryCost(SHUFERSAL_DELIVERY, null, { subtotal: 200 }).serviceFee).toBe(0);
  });

  it("still reports a service fee when the delivery fee is unknown", () => {
    // Partial knowledge is worth returning; a null total says the sum is not
    // trustworthy, without discarding the part we do know.
    const result = computeDeliveryCost([], WOLT, { subtotal: 100 });
    expect(result.serviceFee).toBe(5);
    expect(result.totalFees).toBeNull();
  });
});

describe("minimum order", () => {
  it("blocks an order below the retailer's minimum and says by how much", () => {
    // Yango Deli's ₪99 is not "delivery costs more below ₪99" — below ₪99 there
    // is no order.
    expect(checkMinimumOrder(99, true, 71.5)).toEqual({
      meetsMinimum: false,
      minimumOrder: 99,
      amountToMinimum: 27.5,
      minimumKnown: true,
    });
  });

  it("clears the minimum at exactly the threshold", () => {
    expect(checkMinimumOrder(70, true, 70).meetsMinimum).toBe(true);
  });

  it("treats a retailer with no minimum as always orderable", () => {
    // Shufersal and Rami Levy both state none; that is a fact, not a gap.
    expect(checkMinimumOrder(null, true, 12)).toMatchObject({
      meetsMinimum: true,
      minimumKnown: true,
    });
  });

  it("does not hide a storefront just because we never looked up its minimum", () => {
    // Excluding it would silently drop a real option; the flag lets the caller
    // hedge instead of being wrong.
    expect(checkMinimumOrder(null, false, 12)).toMatchObject({
      meetsMinimum: true,
      minimumKnown: false,
    });
  });
});
