/**
 * What a delivered basket actually costs, and whether it can be ordered at all.
 *
 * Kept pure and dependency-free so the arithmetic can be tested against the real
 * published tariffs without a database. Everything here operates on shekels.
 */

/** How much we trust a number a human copied off a retailer's terms page. */
export type TermsConfidence = "verified" | "reported" | "estimated";

export type FulfillmentServiceType = "delivery" | "pickup" | "marketplace";

export interface DeliveryTariffBand {
  slotType: string;
  /** Inclusive lower bound on the item subtotal; null = unbounded. */
  minSubtotal: number | null;
  /** Exclusive upper bound; null = unbounded. */
  maxSubtotal: number | null;
  fee: number;
  /** null = available to anyone. Otherwise the condition that unlocks this rate. */
  membership: string | null;
  /**
   * True when `fee` is a documented LOWER BOUND rather than the charge.
   *
   * Wolt publishes `delivery_base_price` as the fee at zero distance and computes
   * the real figure at checkout from the courier route, so ₪10 is what a shopper
   * pays at best and never what they pay at worst. Reporting it as an ordinary
   * flat fee is a confidently understated number, which is the one failure this
   * whole subsystem exists to prevent — so callers must present it as "from ₪10".
   */
  feeIsFloor?: boolean;
}

export interface ServiceFeeRule {
  /** Percent of the pre-discount item total, e.g. 5 for Wolt's דמי תפעול. */
  percent: number;
  min: number;
  max: number;
}

/**
 * A saving the shopper can reach by spending more.
 *
 * Deliberately not called "free delivery": Shufersal's pickup tariff drops from
 * ₪15 to ₪10 above ₪750 without ever reaching zero, and that is the same advice.
 * `freeDeliveryThreshold` on the result covers the special case where it does.
 */
export interface FeeBreak {
  /** Subtotal at which the cheaper band starts. */
  atSubtotal: number;
  /** The fee once you are there. */
  fee: number;
  /** Shekels of extra goods needed to reach it. */
  gap: number;
  /** Shekels saved on the fee by getting there. */
  saving: number;
  /**
   * True when the gap costs less than the saving — i.e. spending more leaves the
   * shopper better off overall. Worth volunteering unprompted; that is the whole
   * point of modelling the fee as a step function.
   */
  worthTopUp: boolean;
}

export interface DeliveryCostInput {
  /** Item subtotal after promotions — what the shopper pays for goods. */
  subtotal: number;
  /**
   * Item subtotal BEFORE promotions. Wolt computes its service fee on this
   * figure and says so in its own terms ("הנחות ומבצעים לא ילקחו בחשבון"),
   * so using the discounted total would understate the bill.
   */
  preDiscountSubtotal?: number;
  slotType?: string;
  /** Memberships the shopper says they hold, e.g. ["club"]. */
  memberships?: readonly string[];
}

export interface DeliveryCostResult {
  /** null when no band matches — the fee is unknown, not zero. */
  deliveryFee: number | null;
  serviceFee: number;
  /** deliveryFee + serviceFee, or null when the delivery fee is unknown. */
  totalFees: number | null;
  /** The band that produced the fee, for explanation. */
  appliedBand: DeliveryTariffBand | null;
  /** True when `deliveryFee` is a lower bound, not the charge. See feeIsFloor. */
  deliveryFeeIsFloor: boolean;
  /** Set when the applied band required a membership the shopper holds. */
  requiresMembership: string | null;
  /** The next cheaper band up, when there is one. */
  nextFeeBreak: FeeBreak | null;
  /** Subtotal at which delivery becomes free, when a zero band exists. */
  freeDeliveryThreshold: number | null;
}

function bandMatches(
  band: DeliveryTariffBand,
  subtotal: number,
  slotType: string,
  memberships: readonly string[],
): boolean {
  if (band.slotType !== slotType) return false;
  if (band.membership != null && !memberships.includes(band.membership)) return false;
  if (band.minSubtotal != null && subtotal < band.minSubtotal) return false;
  if (band.maxSubtotal != null && subtotal >= band.maxSubtotal) return false;
  return true;
}

/** Round to agorot. Fee arithmetic on floats otherwise leaks 0.30000000000000004. */
function agorot(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeServiceFee(
  rule: ServiceFeeRule | null | undefined,
  preDiscountSubtotal: number,
): number {
  if (!rule) return 0;
  const raw = (preDiscountSubtotal * rule.percent) / 100;
  return agorot(Math.min(rule.max, Math.max(rule.min, raw)));
}

/**
 * The cheapest band the shopper could reach by adding goods.
 *
 * Scans bands strictly above the current subtotal and picks the one with the
 * smallest fee, tie-broken by the smallest gap: reaching ₪750 to save ₪5 beats
 * reaching ₪900 to save the same ₪5.
 */
function findNextFeeBreak(
  bands: readonly DeliveryTariffBand[],
  subtotal: number,
  currentFee: number,
  slotType: string,
  memberships: readonly string[],
): FeeBreak | null {
  let best: FeeBreak | null = null;
  for (const band of bands) {
    if (band.slotType !== slotType) continue;
    if (band.membership != null && !memberships.includes(band.membership)) continue;
    if (band.minSubtotal == null || band.minSubtotal <= subtotal) continue;
    if (band.fee >= currentFee) continue;
    const gap = agorot(band.minSubtotal - subtotal);
    const saving = agorot(currentFee - band.fee);
    const candidate: FeeBreak = {
      atSubtotal: band.minSubtotal,
      fee: band.fee,
      gap,
      saving,
      // Strictly less: spending ₪10 to save ₪10 is a wash, and calling it a win
      // pushes the shopper into buying something they did not want.
      worthTopUp: gap < saving,
    };
    if (
      best == null ||
      candidate.fee < best.fee ||
      (candidate.fee === best.fee && candidate.gap < best.gap)
    ) {
      best = candidate;
    }
  }
  return best;
}

export function computeDeliveryCost(
  bands: readonly DeliveryTariffBand[],
  serviceFeeRule: ServiceFeeRule | null | undefined,
  input: DeliveryCostInput,
): DeliveryCostResult {
  const slotType = input.slotType ?? "standard";
  const memberships = input.memberships ?? [];
  const subtotal = input.subtotal;
  const serviceFee = computeServiceFee(
    serviceFeeRule,
    input.preDiscountSubtotal ?? subtotal,
  );

  const matching = bands.filter((b) => bandMatches(b, subtotal, slotType, memberships));
  // A shopper holding the membership gets the membership rate, so the cheapest
  // matching band is the one they actually pay — not the public one.
  const appliedBand =
    matching.length === 0
      ? null
      : matching.reduce((cheapest, b) => (b.fee < cheapest.fee ? b : cheapest));

  if (!appliedBand) {
    return {
      deliveryFee: null,
      serviceFee,
      totalFees: null,
      appliedBand: null,
      deliveryFeeIsFloor: false,
      requiresMembership: null,
      nextFeeBreak: null,
      freeDeliveryThreshold: freeThreshold(bands, slotType, memberships),
    };
  }

  return {
    deliveryFee: appliedBand.fee,
    serviceFee,
    totalFees: agorot(appliedBand.fee + serviceFee),
    appliedBand,
    deliveryFeeIsFloor: appliedBand.feeIsFloor === true,
    requiresMembership: appliedBand.membership,
    nextFeeBreak: findNextFeeBreak(bands, subtotal, appliedBand.fee, slotType, memberships),
    freeDeliveryThreshold: freeThreshold(bands, slotType, memberships),
  };
}

function freeThreshold(
  bands: readonly DeliveryTariffBand[],
  slotType: string,
  memberships: readonly string[],
): number | null {
  const free = bands.filter(
    (b) =>
      b.slotType === slotType &&
      b.fee === 0 &&
      b.minSubtotal != null &&
      (b.membership == null || memberships.includes(b.membership)),
  );
  if (free.length === 0) return null;
  return Math.min(...free.map((b) => b.minSubtotal as number));
}

export interface MinimumOrderCheck {
  meetsMinimum: boolean;
  minimumOrder: number | null;
  /** Shekels of extra goods needed before the order can be placed at all. */
  amountToMinimum: number | null;
  /** False when the retailer's minimum is simply not known to us. */
  minimumKnown: boolean;
}

/**
 * Whether the order can be placed.
 *
 * A minimum order is an eligibility rule, not a ranking penalty. Yango Deli's
 * ₪99 is not "delivery costs more below ₪99" — below ₪99 there is no order. A
 * plan that fails this must never be presented as the cheapest option, which is
 * exactly what folding it into a cost would do.
 */
export function checkMinimumOrder(
  minimumOrder: number | null | undefined,
  minimumKnown: boolean,
  subtotal: number,
): MinimumOrderCheck {
  if (minimumOrder == null) {
    return {
      // Unknown minimums are treated as met: excluding a storefront because we
      // failed to look up its terms hides a real option. The caller reports
      // minimumKnown=false so the answer can be hedged instead of wrong.
      meetsMinimum: true,
      minimumOrder: null,
      amountToMinimum: null,
      minimumKnown,
    };
  }
  const meets = subtotal >= minimumOrder;
  return {
    meetsMinimum: meets,
    minimumOrder,
    amountToMinimum: meets ? null : agorot(minimumOrder - subtotal),
    minimumKnown,
  };
}
