import type {
  CoverageConfidence,
  CoverageScope,
  FeeBreak,
  TermsConfidence,
} from "@super-mcp/shared";
import type { LocationOriginMeta } from "../../lib/locationInput.js";
import type {
  BasketAssumption,
  BasketItemInput,
  BasketItemStatus,
  BasketLine,
  BasketMissingItem,
  BasketQuestion,
  BasketResolutionMode,
  BasketResponseDetail,
  BasketTotalScope,
} from "../basket/types.js";

/**
 * What the shopper is optimising for.
 *
 * Deliberately NOT the physical surface's cheapest/balanced/closest. There is no
 * "closest" online — a storefront either delivers to you or it does not — and the
 * axis that replaces distance is how much of the price we can actually stand
 * behind. `balanced` prefers a storefront whose terms we verified over one whose
 * fee we had to assume, when the money is close; `cheapest` takes the lowest
 * number and lets the caller read the confidence itself.
 */
export type DeliveryPreference = "cheapest" | "balanced";

export interface DeliveryAddressInput {
  /** Free text, e.g. "מנדלסון 1, תל אביב". Geocoded like the physical surface. */
  address?: string;
  city?: string;
  near?: { lat: number; lng: number };
}

export interface DeliveryOptimizeInput extends DeliveryAddressInput {
  items: BasketItemInput[];
  preference?: DeliveryPreference;
  /** standard | pickup | express — selects which tariff bands apply. */
  slotType?: string;
  /** Memberships the shopper holds, e.g. ["club", "credit_card"]. */
  memberships?: string[];
  includeClub?: boolean;
  includeCoupon?: boolean;
  resolutionMode?: BasketResolutionMode;
  responseDetail?: BasketResponseDetail;
  locationOrigin?: LocationOriginMeta;
  geocodeMs?: number;
}

export interface DeliveryResumeInput {
  continuation: string;
  answers: Array<{ itemIndex: number; productId: string }>;
}

export type DeliveryOptimizeRequest = DeliveryOptimizeInput | DeliveryResumeInput;

export interface DeliveryTermsProvenance {
  /**
   * verified  read from the retailer's own binding terms on `verifiedAt`
   * reported  a cited secondary source
   * estimated a category default
   * unknown   no tariff recorded — the fee is genuinely not known
   */
  confidence: TermsConfidence | "unknown";
  verifiedAt: string | null;
  sourceUrl: string | null;
  /**
   * True when the terms are older than the catalogue's TTL. A stale row is
   * reported as unknown rather than quoted, because the observed failure is a
   * fee that sat unchanged for years and then moved 20% in a month.
   */
  stale: boolean;
}

export interface DeliveryCoverageReport {
  serves: boolean;
  matchedScope: CoverageScope | null;
  confidence: CoverageConfidence | null;
  reason: "outside_service_area" | "address_too_vague" | "coverage_unknown" | null;
}

export interface DeliveryPlan {
  serviceSlug: string;
  brand: string;
  serviceType: "delivery" | "pickup" | "marketplace";
  marketplace: string | null;
  storefrontUrl: string | null;
  chainId: string;
  chainName: string;
  storeId: string;
  currency: string;

  /** Money for goods at this storefront, over the lines it prices. */
  itemsSubtotal: number;
  /** Same-basket item figure: adds a market reference price for missing lines. */
  itemsComparableSubtotal: number;
  totalScope: BasketTotalScope;

  /** null means not known — never treat as zero. */
  deliveryFee: number | null;
  /** Ranking-only stand-in used when `deliveryFee` is null. Never a quote. */
  assumedDeliveryFee: number | null;
  /**
   * True when `deliveryFee` is a published LOWER BOUND, not the charge.
   *
   * Wolt sets its fee at checkout from the courier route and publishes only the
   * zero-distance base, so ₪10 is the best case and never the worst. Quote it as
   * "from ₪10" — and note deliveredTotal is a lower bound too.
   */
  deliveryFeeIsFloor: boolean;
  serviceFee: number;
  /** itemsSubtotal + deliveryFee + serviceFee. null when the fee is unknown. */
  deliveredTotal: number | null;
  /** The figure storefronts are ranked on. Always present. */
  deliveredComparableTotal: number;
  deliveryTerms: DeliveryTermsProvenance;

  meetsMinimum: boolean;
  minimumOrder: number | null;
  amountToMinimum: number | null;
  minimumKnown: boolean;
  requiresMembership: string | null;

  coverage: DeliveryCoverageReport;

  freeDeliveryThreshold: number | null;
  /** A cheaper fee tier the shopper could reach by spending more. */
  nextFeeBreak: FeeBreak | null;

  pricedLines: number;
  resolvableLines: number;
  requestedLines: number;
  coverageRatio: number;
  imputedTotal: number;
  imputedLines: number;
  clubOnlyLines: number;
  couponOnlyLines: number;
  /**
   * Priced lines whose price the retailer last published over
   * STALE_PRICE_DAYS ago.
   *
   * Not cosmetic: Rami Levy's online storefront publishes 44.6% of its prices
   * with a source timestamp older than 30 days and 2,841 of them older than a
   * year, while every other storefront measures 0%. Per-line `freshness` has
   * always carried the timestamp, but nothing added it up, so a basket quoting a
   * thirteen-month-old price looked exactly like one quoting yesterday's.
   */
  stalePricedLines: number;
  lines: BasketLine[];
  linesTruncated?: boolean;
  missingItems: BasketMissingItem[];
}

/**
 * A recommendation, without the line detail that `plans` already carries.
 *
 * The three recommendation fields name storefronts that are always present in
 * `plans` too, so repeating every priced line inside each of them was a quarter
 * of the response for nothing: 29,779 bytes of a 119,719-byte answer to a
 * 12-line basket, on a surface whose result an agent has to hold in context.
 * Look the storefront up in `plans` by `serviceSlug` for its lines.
 */
export type DeliveryPlanSummary = Omit<DeliveryPlan, "lines" | "missingItems">;

export interface UnavailableStorefront {
  serviceSlug: string;
  brand: string;
  chainName: string;
  reason:
    | "outside_service_area"
    | "address_too_vague"
    | "coverage_unknown"
    | "below_minimum_order"
    | "no_lines_priced"
    | "no_pickup_option"
    | "no_express_option";
  /** Human-readable detail, e.g. "add ₪27.50 to reach the ₪99 minimum". */
  detail: string | null;
  /**
   * Shekels of extra goods needed, when `reason` is `below_minimum_order`.
   *
   * Both prose surfaces tell the model to report `amountToMinimum`, and no
   * returned PLAN can ever carry it: plans are filtered to `meetsMinimum` before
   * ranking, so the field is null on every one of them. The number only exists
   * for storefronts that landed here, so this is where it has to be readable
   * rather than buried in a sentence.
   */
  amountToMinimum: number | null;
}

export interface DeliveryOptimizeCompleteResult {
  status: "complete";
  currency: string;
  address: {
    requested: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    /**
     * How precisely the address was located.
     *
     * Load-bearing on this surface in a way it is not on the physical one. A
     * branch placed at a city centroid is reported with an inflated distance and
     * the shopper can still judge it; a delivery polygon tested against a city
     * centroid returns a confident yes or no about an address that was never
     * actually located. Anything coarser than `street` means a coverage verdict
     * should be hedged.
     */
    precision: string | null;
    /** Geocoder caveat, e.g. that the point fell back to the city centre. */
    warning: string | null;
  };
  preference: DeliveryPreference;
  slotType: string;
  /** Lowest deliveredComparableTotal among orderable plans. */
  cheapestDelivered: DeliveryPlanSummary | null;
  /** Best plan whose delivery fee we can actually stand behind. */
  bestVerifiedTerms: DeliveryPlanSummary | null;
  /**
   * Most of the list obtainable as ONE order, cheapest among equals.
   *
   * `cheapestDelivered` prices the gaps at a market reference, which answers
   * "cheapest if you shop twice". This answers "cheapest that actually arrives".
   */
  bestSingleOrder: DeliveryPlanSummary | null;
  plans: DeliveryPlan[];
  unavailableStores: UnavailableStorefront[];
  items: BasketItemStatus[];
  assumptions: BasketAssumption[];
  storefrontsCompared: number;
  notes: string[];
}

export interface DeliveryNeedsConfirmationResult {
  status: "needs_confirmation";
  continuation: string;
  questions: BasketQuestion[];
  items: BasketItemStatus[];
  storefrontsCompared: number;
}

export type DeliveryOptimizeResult =
  | DeliveryOptimizeCompleteResult
  | DeliveryNeedsConfirmationResult;

/**
 * Every field a delivery plan carries, as data.
 *
 * It lives in `src` and not beside the test that uses it because only `src` is
 * typechecked (`tsconfig.json` includes `src/**` alone), so a `Record<keyof
 * DeliveryPlan, true>` written in a test compiles no matter what it says. One
 * did: it listed `storeName`, which no delivery plan carries, and nothing
 * complained.
 *
 * Here the compiler enforces both directions — a new field on `DeliveryPlan` is
 * a missing key, and a field that does not exist is an excess one — which is
 * what lets the MCP instructions be checked against the payload they describe.
 */
export const DELIVERY_PLAN_FIELDS: Record<keyof DeliveryPlan, true> = {
  serviceSlug: true,
  brand: true,
  serviceType: true,
  marketplace: true,
  storefrontUrl: true,
  chainId: true,
  chainName: true,
  storeId: true,
  currency: true,
  itemsSubtotal: true,
  itemsComparableSubtotal: true,
  totalScope: true,
  deliveryFee: true,
  assumedDeliveryFee: true,
  deliveryFeeIsFloor: true,
  serviceFee: true,
  deliveredTotal: true,
  deliveredComparableTotal: true,
  deliveryTerms: true,
  meetsMinimum: true,
  minimumOrder: true,
  amountToMinimum: true,
  minimumKnown: true,
  requiresMembership: true,
  coverage: true,
  freeDeliveryThreshold: true,
  nextFeeBreak: true,
  pricedLines: true,
  resolvableLines: true,
  requestedLines: true,
  coverageRatio: true,
  imputedTotal: true,
  imputedLines: true,
  clubOnlyLines: true,
  couponOnlyLines: true,
  stalePricedLines: true,
  lines: true,
  linesTruncated: true,
  missingItems: true,
};
