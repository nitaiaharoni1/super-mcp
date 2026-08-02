import { listFulfillmentServices } from "@super-mcp/db";
import type { DeliveryTariffBand } from "@super-mcp/shared";
import { AppError, canonicalizeCity, centroidForCity, extractCityFromLocation } from "@super-mcp/shared";
import { coverageReport, termsProvenance } from "./planStorefronts.js";
import type { DeliveryCoverageReport, DeliveryTermsProvenance } from "./types.js";

export interface DeliveryOptionSummary {
  serviceSlug: string;
  brand: string;
  chainId: string;
  chainName: string;
  serviceType: "delivery" | "pickup" | "marketplace";
  marketplace: string | null;
  storefrontUrl: string | null;
  currency: string;
  /**
   * Lowest fee available to ANYONE, i.e. ignoring membership rates.
   * null when the terms are not known. See memberRates for conditional prices.
   */
  deliveryFeeFrom: number | null;
  /** Cheaper rates that need a card or subscription, with the condition named. */
  memberRates: Array<{ membership: string; fee: number; minSubtotal: number | null }>;
  freeDeliveryThreshold: number | null;
  minimumOrder: number | null;
  minimumKnown: boolean;
  serviceFeeDescription: string | null;
  pickupAvailable: boolean;
  deliveryTerms: DeliveryTermsProvenance;
  /**
   * Verdict for a specific address, or null when no address was supplied.
   *
   * Null rather than `{serves:false}`: `getDeliveryTerms` takes a slug and
   * nothing else, so it can never test an address, and reporting a denial there
   * told every caller the storefront does not deliver to them.
   */
  coverage: DeliveryCoverageReport | null;
  /** How many prices we hold for this storefront: 0 means we cannot cost a basket. */
  catalogSize: number | null;
  notes: string | null;
}

/**
 * The lowest fee anyone can get, which is not the lowest fee in the table.
 *
 * Rami Levy's credit-card holders kept ₪29.90 when the public rate rose to
 * ₪35.90, and Wolt+ subscribers pay ₪0 above a ₪140 basket. Taking a plain
 * minimum over the bands advertises both as the price, which is the same error
 * as quoting a clubOnly shelf price — and here it is the headline number.
 *
 * Membership rates are still worth surfacing, so they come back separately with
 * the condition named.
 */
export function publicFeeFrom(tariffs: DeliveryTariffBand[]): number | null {
  const standard = tariffs.filter((t) => t.slotType === "standard" && t.membership == null);
  if (standard.length === 0) return null;
  return Math.min(...standard.map((t) => t.fee));
}

export function memberRates(
  tariffs: DeliveryTariffBand[],
): Array<{ membership: string; fee: number; minSubtotal: number | null }> {
  return tariffs
    .filter((t) => t.slotType === "standard" && t.membership != null)
    .map((t) => ({ membership: t.membership as string, fee: t.fee, minSubtotal: t.minSubtotal }))
    .sort((a, b) => a.fee - b.fee);
}

function describeServiceFee(
  fee: { percent: number; min: number; max: number } | null,
): string | null {
  if (!fee) return null;
  return `${fee.percent}% of the pre-discount item total, between ₪${fee.min.toFixed(2)} and ₪${fee.max.toFixed(2)}`;
}

/**
 * Who delivers to this address, without pricing a basket.
 *
 * The counterpart to `list_stores` on the physical surface, and deliberately
 * shaped differently: a branch list answers "what is near me" and this answers
 * "who will come to me, on what terms, and how sure are we". Storefronts that do
 * not serve the address are still returned, with `coverage.serves = false` and a
 * reason, because "Carrefour does not deliver to Tel Aviv" is the answer to the
 * question a shopper actually asked.
 */
export async function listDeliveryOptions(params: {
  city?: string;
  address?: string;
  near?: { lat: number; lng: number };
  chainId?: string;
  includeUnavailable?: boolean;
}): Promise<{ options: DeliveryOptionSummary[]; destinationKnown: boolean }> {
  const services = await listFulfillmentServices({ chainId: params.chainId });
  // Same reason as optimizeDelivery: a settlement-list service area can only be
  // tested against a town, so the town is parsed out of a free-text address.
  const named = params.city ?? (params.address ? extractCityFromLocation(params.address) : null);
  // canonicalizeCity echoes anything it does not recognise straight back, so it
  // cannot answer "is this a real place". Keeping the echo is right: published
  // service areas are the retailers' own spellings, and roughly 1,200 Israeli
  // localities exist against 135 canonical ones, so a real town can match a
  // published area without ever being canonical. It just is not evidence.
  const city = named ? (canonicalizeCity(named) ?? named) : null;
  // A radius or polygon rule needs a point. Without one, every regional depot
  // reports "address too vague" and a shopper who typed their town sees none of
  // them — so fall back to the town's centroid, which is what the existing
  // physical geocoder already does with a bare city.
  const centroid = params.near ?? (city ? centroidForCity(city) : null);
  const destination = {
    city,
    lat: centroid?.lat ?? null,
    lng: centroid?.lng ?? null,
  };
  const now = new Date();
  const coverageByService = services.map((service) => coverageReport(service, destination));
  /**
   * Whether anything actually recognised this destination.
   *
   * The test used to be `destination.city != null`, and since an unrecognised
   * name is echoed into that field, it was true for absolutely any non-empty
   * string. A typo, or a region name such as "בקעת אונו" (a valley, not a
   * town), came back `destinationKnown: true` carrying exactly one storefront,
   * so an agent would report that only Shufersal delivers there. That one hit
   * was the NATIONAL rule, which serves everyone and is therefore no evidence
   * at all: only a coordinate, or a city/radius/polygon match, places a
   * shopper.
   */
  const destinationKnown =
    destination.lat != null ||
    coverageByService.some((c) => c.serves && c.matchedScope !== "national");

  const options = services.map<DeliveryOptionSummary>((service, index) => {
    const standardFee = publicFeeFrom(service.tariffs);
    return {
      serviceSlug: service.slug,
      brand: service.brand,
      chainId: service.chainId,
      chainName: service.chainName,
      serviceType: service.serviceType,
      marketplace: service.marketplace,
      storefrontUrl: service.storefrontUrl,
      currency: service.currency,
      deliveryFeeFrom: standardFee,
      memberRates: memberRates(service.tariffs),
      freeDeliveryThreshold:
        service.tariffs
          .filter(
            (t) =>
              t.slotType === "standard" &&
              t.fee === 0 &&
              t.minSubtotal != null &&
              // Wolt+ delivers free above ₪140; presenting that as the threshold
              // anyone can reach by spending more is simply false.
              t.membership == null,
          )
          .map((t) => t.minSubtotal as number)
          .sort((a, b) => a - b)[0] ?? null,
      minimumOrder: service.minimumOrder,
      minimumKnown: service.minimumOrderKnown,
      serviceFeeDescription: describeServiceFee(service.serviceFee),
      pickupAvailable: service.tariffs.some((t) => t.slotType === "pickup"),
      deliveryTerms: termsProvenance(service, standardFee != null, now),
      // No address to test means no verdict, not a refusal.
      coverage: destinationKnown ? coverageByService[index]! : null,
      catalogSize: null,
      notes: service.notes,
    };
  });

  const filtered =
    params.includeUnavailable || !destinationKnown
      ? options
      : options.filter((option) => option.coverage?.serves === true);

  return { options: filtered, destinationKnown };
}

/** One storefront's full published terms, for explaining a plan. */
export async function getDeliveryTerms(slug: string): Promise<{
  service: DeliveryOptionSummary;
  tariffs: Array<{
    slotType: string;
    minSubtotal: number | null;
    maxSubtotal: number | null;
    fee: number;
    membership: string | null;
  }>;
  coverage: Array<{ scope: string; cityKey: string | null; radiusKm: number | null; confidence: string }>;
}> {
  const [service] = await listFulfillmentServices({ slug, includeUnpriced: true });
  if (!service) {
    throw new AppError("not_found", `no delivery service with slug '${slug}'`, 404);
  }
  const { options } = await listDeliveryOptions({ chainId: service.chainId, includeUnavailable: true });
  const summary = options.find((option) => option.serviceSlug === slug);
  if (!summary) {
    throw new AppError("not_found", `no delivery service with slug '${slug}'`, 404);
  }
  return {
    service: summary,
    tariffs: service.tariffs.map((t) => ({
      slotType: t.slotType,
      minSubtotal: t.minSubtotal,
      maxSubtotal: t.maxSubtotal,
      fee: t.fee,
      membership: t.membership,
    })),
    coverage: service.coverage.map((c) => ({
      scope: c.scope,
      cityKey: c.cityKey ?? null,
      radiusKm: c.radiusKm ?? null,
      confidence: c.confidence,
    })),
  };
}
