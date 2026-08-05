import type { RawRecord } from "@super-mcp/shared";

/**
 * Wolt's synthetic chain id.
 *
 * Real chains key on their legal barcode prefix. Wolt has none because it is not
 * a supermarket chain filing under the transparency regulations, so it gets an
 * explicit non-numeric id. That also makes it obvious in any query that these
 * rows did not come from a regulated feed.
 */
/**
 * Retained only so an old row or an external reference to "IL-WOLT" is still
 * recognisable. Nothing writes it any more: every venue is filed under its
 * BRAND's chain (see brands.ts), because a single "Wolt" chain made
 * Victory-on-Wolt and Shufersal-on-Wolt indistinguishable in results while their
 * price books are genuinely different.
 */
export const LEGACY_WOLT_CHAIN_ID = "IL-WOLT";

export interface VenueMeta {
  name: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Pull the JSON object that encloses a given key occurrence out of a page.
 *
 * Wolt server-renders its state into the HTML rather than exposing a documented
 * endpoint, so the object has to be recovered by brace matching. Deliberately
 * defensive: a shape change must yield nothing rather than yield nonsense, and
 * the caller reports zero records, which the pipeline already treats as a failed
 * file.
 */
function objectsContaining(html: string, key: string, maxObjects = 5000): unknown[] {
  const out: unknown[] = [];
  const needle = `"${key}"`;
  let from = 0;
  while (out.length < maxObjects) {
    const hit = html.indexOf(needle, from);
    if (hit === -1) break;
    from = hit + needle.length;
    // Walk back to the opening brace of the object that owns this key.
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
    if (start === -1) continue;
    // Walk forward to its closing brace.
    depth = 0;
    for (let i = start; i < html.length && i - start < 40000; i += 1) {
      const ch = html[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            out.push(JSON.parse(html.slice(start, i + 1)));
          } catch {
            // Not valid JSON on its own; skip rather than guess.
          }
          from = i + 1;
          break;
        }
      }
    }
  }
  return out;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Wolt quotes money in agorot. Everything downstream is shekels. */
function agorotToShekels(value: unknown): number | null {
  const n = num(value);
  return n == null ? null : Math.round(n) / 100;
}

/**
 * Normalise a Wolt barcode to the GTIN form the feeds use.
 *
 * Wolt pads to GTIN-14 ("07290101503606"); the regulated feeds publish EAN-13
 * ("7290101503606"). Leaving the pad on would make the same physical product two
 * different products, which is the exact failure the GTIN join exists to prevent.
 */
export function normalizeWoltGtin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const trimmed = digits.replace(/^0+/, "");
  return trimmed.length >= 8 ? trimmed : digits;
}

/** Size and unit out of Wolt's free-text `unit_info`, e.g. "900 ג׳", "1.5 ליטר". */
export function parseUnitInfo(info: unknown): { qty: number; unit: string } | null {
  if (typeof info !== "string") return null;
  const match = info.match(/(\d+(?:[.,]\d+)?)\s*([^\d\s]+)/);
  if (!match?.[1] || !match[2]) return null;
  const qty = Number(match[1].replace(",", "."));
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return { qty, unit: match[2].trim() };
}

/**
 * The venue itself: a store row plus everything Wolt publishes about delivery.
 *
 * `storeType: 2` is deliberate. These are not walk-in shops, and stamping the
 * feed's own online code means `classifyStoreKind` files them exactly like a
 * regulated online storefront rather than guessing from the name.
 */
export function* parseVenuePage(
  html: string,
  slug: string,
  meta: VenueMeta,
  chainId: string,
): Generator<RawRecord> {
  const [venue] = objectsContaining(html, "delivery_base_price", 1);
  const v = (venue ?? {}) as Record<string, unknown>;
  const info = (v["info"] ?? {}) as Record<string, unknown>;

  yield {
    kind: "store",
    chainId,
    storeId: slug,
    name: meta.name,
    address: meta.address ?? `https://wolt.com/he/isr/venue/${slug}`,
    city: meta.city ?? undefined,
    geo:
      meta.lat != null && meta.lng != null ? { lat: meta.lat, lng: meta.lng } : undefined,
    storeType: 2,
    raw: {
      woltSlug: slug,
      // Delivery terms, machine-readable straight from the venue. This is the
      // part the curated catalogue has to be hand-maintained for every chain,
      // and here it comes free and current.
      deliveryBasePrice: agorotToShekels(v["delivery_base_price"]),
      orderMinimum: info["venue_info_order_minimum"] ?? null,
      serviceFee: v["service_fee_estimate"] ?? null,
      serviceFeeDescription: info["venue_info_service_fee_description"] ?? null,
      deliveryMethods: v["delivery_methods"] ?? null,
      deliveryGeoRange: v["delivery_geo_range"] ?? null,
      deliveryTimes: v["delivery_times_schedule"] ?? null,
      // False on every Israeli grocery venue measured, i.e. nobody commits to
      // shelf parity. Carried so the claim stays evidenced rather than asserted.
      showZeroMarkup: v["show_zero_markup"] ?? null,
      brandName: v["brand_name"] ?? null,
    },
  };
}

/** Priced items off one category page. */
export function* parseCategoryPage(
  html: string,
  slug: string,
  chainId: string,
): Generator<RawRecord> {
  const seen = new Set<string>();
  const ts = new Date();
  for (const raw of objectsContaining(html, "barcode_gtin")) {
    const item = raw as Record<string, unknown>;
    const gtin = normalizeWoltGtin(item["barcode_gtin"]);
    const name = typeof item["name"] === "string" ? item["name"] : null;
    const price = agorotToShekels(item["price"]);
    if (!gtin || !name || price == null || price <= 0) continue;
    if (seen.has(gtin)) continue;
    seen.add(gtin);

    const size = parseUnitInfo(item["unit_info"]);
    yield {
      kind: "price",
      chainId,
      storeId: slug,
      itemCode: gtin,
      // 1 means "this code is a real barcode" in the feeds, which is what makes
      // the row joinable to the same product from a regulated chain.
      itemType: 1,
      name,
      qty: size?.qty,
      unit: size?.unit,
      price,
      ts,
    };
  }
}
