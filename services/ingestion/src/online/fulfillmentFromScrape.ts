import { listScrapedOnlineStores, upsertFulfillmentService } from "@super-mcp/db";
import type { CoverageRule, DeliveryTariffBand } from "@super-mcp/shared";
import { fetchAllowedFeed } from "../sources/common/allowedFetch.js";
import { WOLT_HOSTS } from "./sources/wolt/adapter.js";
import { WOLT_CHAIN_ID } from "./sources/wolt/parse.js";
import { STORAI_RETAILERS } from "./sources/storai/adapter.js";

/**
 * Delivery terms that maintain themselves.
 *
 * Every chain in the curated catalogue needs a human to re-read a terms page,
 * which is why those rows carry a 90-day TTL and decay to "unknown". Wolt is the
 * exception worth exploiting: it publishes the base fee, the order minimum, the
 * service-fee rule and the exact service polygon in the same payload as its
 * prices. So for Wolt venues the terms are re-derived on every online ingest and
 * are current to the minute, and they are marked `terms_source = 'scraped'` so
 * nothing applies the curated-table staleness rule to them.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export interface ScrapedFulfillmentResult {
  woltServices: number;
  storAiServices: number;
  skipped: string[];
}

function objectContaining(html: string, key: string): Record<string, unknown> | null {
  const hit = html.indexOf(`"${key}"`);
  if (hit === -1) return null;
  let depth = 0;
  let start = -1;
  for (let i = hit; i >= 0 && hit - i < 20000; i -= 1) {
    const ch = html[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < html.length && i - start < 200000; i += 1) {
    const ch = html[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** "₪70.00" as published by Wolt, into 70. */
export function parseShekelString(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function woltTariffs(venue: Record<string, unknown>): DeliveryTariffBand[] {
  const base = venue["delivery_base_price"];
  if (typeof base !== "number") return [];
  return [
    {
      slotType: "standard",
      minSubtotal: null,
      maxSubtotal: null,
      fee: Math.round(base) / 100,
      membership: null,
      // Wolt's published number is the charge at zero distance; the real fee is
      // computed at checkout from the courier route. Quoting it flat would
      // understate every order, so it is marked as the floor it is.
      feeIsFloor: true,
    },
  ];
}

export function woltCoverage(venue: Record<string, unknown>): CoverageRule[] {
  const range = venue["delivery_geo_range"];
  if (range && typeof range === "object") {
    // Wolt publishes a real ~45-vertex polygon per venue, so coverage is an
    // exact point-in-polygon test rather than the radius guess every chain needs.
    return [{ scope: "polygon", geojson: range, confidence: "verified" }];
  }
  return [];
}

export async function syncScrapedFulfillment(): Promise<ScrapedFulfillmentResult> {
  const skipped: string[] = [];
  let woltServices = 0;
  let storAiServices = 0;

  const stores = await listScrapedOnlineStores(["il-wolt", "il-storai"]);

  for (const store of stores) {
    if (store.chainId === WOLT_CHAIN_ID) {
      const citySlug = (store.city ?? "tel-aviv")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const url = `https://wolt.com/he/isr/${citySlug || "tel-aviv"}/venue/${store.storeCode}`;
      let venue: Record<string, unknown> | null = null;
      try {
        const res = await fetchAllowedFeed(url, WOLT_HOSTS, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept-Language": "he,en",
            "Accept-Encoding": "gzip, deflate, br",
          },
        });
        if (res.ok) venue = objectContaining(await res.text(), "delivery_base_price");
      } catch {
        venue = null;
      }
      if (!venue) {
        skipped.push(`${store.storeCode} (venue payload unavailable)`);
        continue;
      }
      const info = (venue["info"] ?? {}) as Record<string, unknown>;
      const serviceFee = venue["service_fee_estimate"] as
        | { min?: number; max?: number; percentage?: number }
        | undefined;

      await upsertFulfillmentService({
        slug: `wolt-${store.storeCode}`,
        chainId: store.chainId,
        storeId: store.storeId,
        brand: store.name,
        serviceType: "marketplace",
        marketplace: "wolt",
        storefrontUrl: url,
        minimumOrder: parseShekelString(info["venue_info_order_minimum"]),
        minimumOrderKnown: info["venue_info_order_minimum"] != null,
        serviceFee:
          serviceFee?.percentage != null && serviceFee.min != null && serviceFee.max != null
            ? {
                percent: serviceFee.percentage,
                min: serviceFee.min / 100,
                max: serviceFee.max / 100,
              }
            : null,
        // Read from Wolt's own venue payload minutes ago, which is a stronger
        // claim than anything a human transcribed from a terms page.
        termsConfidence: "verified",
        termsVerifiedAt: new Date().toISOString().slice(0, 10),
        termsSourceUrl: url,
        termsSource: "scraped",
        notes:
          "Derived automatically from Wolt's own venue payload on every online ingest, so it does " +
          "not go stale the way the hand-curated chain terms do. The delivery fee is Wolt's " +
          "zero-distance base price and is therefore a floor, not the charge. Item prices are set " +
          "by Wolt above the chain's shelf prices: measured +25% on the one Wolt storefront that " +
          "also files a regulated feed, and never cheaper than the source branch across a 15-item " +
          "check. Wolt's own show_zero_markup flag is false on every Israeli grocery venue.",
        active: true,
        tariffs: woltTariffs(venue),
        coverage: woltCoverage(venue),
      });
      woltServices += 1;
      continue;
    }

    const retailer = STORAI_RETAILERS.find((r) => r.chainId === store.chainId);
    if (!retailer) {
      skipped.push(`${store.chainId}/${store.storeCode} (no source mapping)`);
      continue;
    }
    await upsertFulfillmentService({
      slug: `${retailer.chainId.toLowerCase()}-${store.storeCode}`,
      chainId: store.chainId,
      storeId: store.storeId,
      brand: `${retailer.name} אונליין`,
      serviceType: "delivery",
      marketplace: null,
      storefrontUrl: retailer.storefrontUrl,
      minimumOrder: null,
      // The storefront API carries no terms at all, so this is a real gap rather
      // than a value we have not got round to: the optimiser will report the fee
      // as unknown and rank on a labelled assumption.
      minimumOrderKnown: false,
      serviceFee: null,
      termsConfidence: "estimated",
      termsVerifiedAt: null,
      termsSourceUrl: retailer.storefrontUrl,
      termsSource: "scraped",
      notes:
        "Catalogue and prices scraped from the chain's stor.ai storefront; delivery terms are NOT " +
        "published there and remain unknown. Products from this source carry no barcode, so they " +
        "are chain-scoped and do not take part in cross-chain comparison.",
      active: true,
      tariffs: [],
      coverage: [{ scope: "national", confidence: "estimated" }],
    });
    storAiServices += 1;
  }

  return { woltServices, storAiServices, skipped };
}
