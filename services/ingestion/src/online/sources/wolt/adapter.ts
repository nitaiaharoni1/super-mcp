import type {
  FeedFile,
  RawBlob,
  RawRecord,
  SourceAdapter,
} from "@super-mcp/shared";
import { fetchAllowedFeed } from "../../../sources/common/allowedFetch.js";
import { parseVenuePage, parseCategoryPage } from "./parse.js";
import { WOLT_CHAIN_IDS, woltBrandForVenue, type WoltBrand } from "./brands.js";

/**
 * Wolt as a chain in its own right, not as a storefront of the chains it hosts.
 *
 * A Wolt venue called "שופרסל | מרמורק" is NOT Shufersal's price list. Measured
 * against the exact branch that fills those orders, Wolt is dearer on 9 of 15
 * items and never cheaper, and the one Wolt venue that also files a regulated
 * feed runs +25% against its chain's shelf prices. Folding these rows into
 * Shufersal would corrupt the shelf prices the physical surface depends on.
 *
 * So Wolt gets its own chain id and its own stores. That is also just true:
 * Wolt sets these prices, and `show_zero_markup` is false on all 613 Israeli
 * grocery venues, which is Wolt's own admission that none of them commit to
 * shelf parity.
 *
 * NOT READY FOR A SCHEDULED NATIONAL RUN. Measured 2026-08-05 from me-west1
 * against the live site, uncapped: Wolt answers `429 Too Many Requests` for most
 * category pages once a crawl gets going. The run "succeeded" in 6.6 minutes
 * having collected 889 price rows across 23 venues, because nearly every fetch
 * was rejected rather than served. A partial crawl is worse than none here: a
 * venue with 4 of a shopper's 12 lines reports a small total precisely because it
 * cannot fill the basket.
 *
 * What this needs before it is scheduled: honour 429 with backoff and a retry
 * budget, throttle to a request rate Wolt tolerates, and treat a venue whose
 * category pages mostly failed as not-ingested rather than as an empty venue.
 * Until then the job exists but nothing schedules it, deliberately.
 *
 * The parser itself is sound and is not the problem: run against a real grocery
 * venue it returned 239 rows with zero errors, and the category parser reads 17
 * to 42 barcoded products per page.
 */
export const WOLT_HOSTS = ["wolt.com", "consumer-api.wolt.com"] as const;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Product lines that are groceries rather than restaurants.
 *
 * Narrowed to the two that actually sell a shopping list, after a full national
 * run measured what the wider set admits. `alcohol` brought in "123 יין
 * ואלכוהול" branches, and `general_merchandise` brought in Adidas stores, a
 * hookah shop, a sweets shop and a cosmetics shop. `pharmacy` reads plausible
 * (Super-Pharm does stock household lines) but is not a supermarket and cannot
 * fill a basket.
 *
 * The damage is not merely irrelevant rows. A store row alone is enough to become
 * an active fulfillment_service, so of 23 venues that run created, 19 had ZERO
 * prices and they were live in the Tel Aviv delivery options as storefronts
 * stocking nothing. A basket comparison that offers a shopper Adidas is worse
 * than one that offers nothing.
 *
 * `grocery` covers Victory and the supermarket venues; `convenience` covers am:pm
 * and the 7-Eleven-style express shops, which is where the 889 real price rows in
 * that run came from.
 */
const GROCERY_PRODUCT_LINES = new Set(["grocery", "convenience"]);

/**
 * Where to look for venues.
 *
 * Wolt's discovery is coordinate-keyed and returns what it would deliver to
 * that point, so national coverage means sweeping population centres. These are
 * the metros the rest of the ingest already covers (see regions.ts), which keeps
 * the online and physical footprints comparable.
 */
export const WOLT_DISCOVERY_POINTS: ReadonlyArray<{ city: string; lat: number; lon: number }> = [
  { city: "תל אביב-יפו", lat: 32.0853, lon: 34.7818 },
  { city: "ירושלים", lat: 31.7683, lon: 35.2137 },
  { city: "חיפה", lat: 32.794, lon: 34.9896 },
  { city: "באר שבע", lat: 31.2518, lon: 34.7913 },
  { city: "ראשון לציון", lat: 31.9642, lon: 34.8047 },
  { city: "פתח תקווה", lat: 32.0878, lon: 34.8878 },
  { city: "נתניה", lat: 32.3215, lon: 34.8532 },
  { city: "אשדוד", lat: 31.8014, lon: 34.6435 },
  { city: "הרצליה", lat: 32.1624, lon: 34.8447 },
  { city: "רמת גן", lat: 32.0684, lon: 34.8248 },
  { city: "כפר סבא", lat: 32.175, lon: 34.9070 },
  { city: "מודיעין", lat: 31.8928, lon: 35.0104 },
];

interface WoltVenue {
  slug: string;
  name: string;
  city: string | null;
  productLine: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  country: string | null;
}

interface DiscoveredVenue extends WoltVenue {
  /** Category page slugs found on the venue's landing page. */
  categorySlugs: string[];
  /** Landing-page HTML, kept so `fetch` does not re-download it. */
  landingHtml: string;
  /** URL path segment Wolt uses for this venue's city, e.g. "tel-aviv". */
  citySlug: string;
}

function collectVenues(node: unknown, out: Map<string, WoltVenue>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectVenues(child, out);
    return;
  }
  if (typeof node !== "object" || node == null) return;
  const obj = node as Record<string, unknown>;
  const venue = obj["venue"];
  if (venue && typeof venue === "object") {
    const v = venue as Record<string, unknown>;
    const slug = typeof v["slug"] === "string" ? v["slug"] : null;
    const productLine = typeof v["product_line"] === "string" ? v["product_line"] : "";
    if (slug && GROCERY_PRODUCT_LINES.has(productLine) && !out.has(slug)) {
      const location = Array.isArray(v["location"]) ? (v["location"] as unknown[]) : null;
      // Wolt returns [lon, lat], the GeoJSON order, not the lat,lng used everywhere else here.
      const lon = location && typeof location[0] === "number" ? location[0] : null;
      const lat = location && typeof location[1] === "number" ? location[1] : null;
      out.set(slug, {
        slug,
        name: typeof v["name"] === "string" ? v["name"] : slug,
        city: typeof v["city"] === "string" ? v["city"] : null,
        productLine,
        lat,
        lng: lon,
        address: typeof v["address"] === "string" ? v["address"] : null,
        country: typeof v["country"] === "string" ? v["country"] : null,
      });
    }
  }
  for (const value of Object.values(obj)) collectVenues(value, out);
}

async function getText(url: string): Promise<string> {
  const res = await fetchAllowedFeed(url, WOLT_HOSTS, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "he,en",
      // Category pages are ~2 MB raw and ~300 KB gzipped. A full venue is 46 of
      // them, so this is the difference between 14 MB and 100 MB per venue.
      "Accept-Encoding": "gzip, deflate, br",
    },
  });
  if (!res.ok) throw new Error(`Wolt fetch ${res.status} for ${url}`);
  return res.text();
}

/** Wolt's own URL slug for a venue's city, taken from the venue page redirect path. */
function citySlugFor(city: string | null): string {
  if (!city) return "tel-aviv";
  return city
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export interface WoltAdapterOptions {
  /**
   * Restrict to venue slugs containing any of these fragments. Without it every
   * grocery venue in reach of the discovery points is ingested, which is several
   * hundred venues and hours of fetching.
   */
  venueFilter?: string[];
  /** Hard cap on venues per run, so a discovery change cannot explode a job. */
  maxVenues?: number;
  /** Categories per venue. Wolt lists ~46; the first N cover the staples. */
  maxCategoriesPerVenue?: number;
}

export function createWoltAdapter(options: WoltAdapterOptions = {}): SourceAdapter {
  const maxVenues = options.maxVenues ?? 25;
  const maxCategories = options.maxCategoriesPerVenue ?? 46;
  const filter = (options.venueFilter ?? []).map((f) => f.toLowerCase()).filter(Boolean);
  // Landing pages are read twice otherwise: once to learn the categories and
  // once to build the store record.
  const landingCache = new Map<string, DiscoveredVenue>();

  return {
    sourceId: "il-wolt",
    market: "IL",
    expectedChainIds: [...WOLT_CHAIN_IDS],

    async discover(): Promise<FeedFile[]> {
      const venues = new Map<string, WoltVenue>();
      for (const point of WOLT_DISCOVERY_POINTS) {
        const url = `https://consumer-api.wolt.com/v1/pages/front?lat=${point.lat}&lon=${point.lon}`;
        try {
          const body = await getText(url);
          collectVenues(JSON.parse(body), venues);
        } catch (err) {
          // One unreachable metro must not lose the other eleven.
          console.error(
            JSON.stringify({ event: "wolt_discovery_point_failed", city: point.city, error: String(err) }),
          );
        }
      }

      // Brand allowlist BEFORE maxVenues, or the cap spends itself on whichever
      // 25 slugs sort first: an uncapped run reached 517 venues across 276 brands,
      // and a capped one filled up on Adidas and a hookah shop while never
      // reaching Wolt Market. See brands.ts for what earns a place.
      const branded: Array<WoltVenue & { brand: WoltBrand }> = [];
      for (const v of venues.values()) {
        const brand = woltBrandForVenue(v.name);
        if (!brand) continue;
        if (filter.length > 0 && !filter.some((f) => v.slug.toLowerCase().includes(f))) continue;
        branded.push({ ...v, brand });
      }
      const selected = branded
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .slice(0, maxVenues);

      const perBrand: Record<string, number> = {};
      for (const v of selected) perBrand[v.brand.chainId] = (perBrand[v.brand.chainId] ?? 0) + 1;
      console.log(
        JSON.stringify({
          event: "wolt_discovery",
          venuesFound: venues.size,
          venuesOnAllowlist: branded.length,
          venuesSelected: selected.length,
          perBrand,
          filtered: filter.length > 0,
        }),
      );

      const files: FeedFile[] = [];
      for (const venue of selected) {
        const citySlug = citySlugFor(venue.city);
        const venueUrl = `https://wolt.com/he/isr/${citySlug}/venue/${venue.slug}`;
        let landingHtml: string;
        try {
          landingHtml = await getText(venueUrl);
        } catch (err) {
          console.error(
            JSON.stringify({ event: "wolt_venue_unreachable", slug: venue.slug, error: String(err) }),
          );
          continue;
        }
        const categorySlugs = [
          ...new Set(
            [...landingHtml.matchAll(new RegExp(`/venue/${venue.slug}/items/([a-z0-9-]+)`, "g"))].map(
              (m) => m[1] as string,
            ),
          ),
        ].slice(0, maxCategories);

        landingCache.set(venue.slug, { ...venue, categorySlugs, landingHtml, citySlug });

        // The venue itself: store row, delivery terms, service area.
        files.push({
          sourceId: "il-wolt",
          kind: "stores",
          remotePath: venueUrl,
          fileName: `venue-${venue.slug}.html`,
          chainId: venue.brand.chainId,
          storeId: venue.slug,
        });
        // One file per category page: this is where the priced items live.
        for (const category of categorySlugs) {
          files.push({
            sourceId: "il-wolt",
            // "prices", NOT "pricesfull". A category page is one of ~46 slices of
            // a venue's catalogue, and `pricesfull` means "this file is the
            // store's complete price list", which licenses the pipeline to delete
            // every row not in it. The delisting guard refused on row count, but
            // relying on that is relying on luck: a venue with few categories
            // would have had most of its prices reaped on every run.
            kind: "prices",
            remotePath: `${venueUrl}/items/${category}`,
            fileName: `${venue.slug}--${category}.html`,
            chainId: venue.brand.chainId,
            storeId: venue.slug,
          });
        }
      }
      return files;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const cached =
        file.kind === "stores" && file.storeId ? landingCache.get(file.storeId) : undefined;
      const html = cached ? cached.landingHtml : await getText(file.remotePath);
      return { sourceId: "il-wolt", file, bytes: Buffer.from(html, "utf8"), fetchedAt: new Date() };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const html = blob.bytes.toString("utf8");
      const slug = blob.file.storeId ?? "";
      // Read off the FeedFile rather than the discovery cache: a blob replayed
      // from data/raw, or fetched in a later process, still knows its brand.
      const chainId = blob.file.chainId ?? "";
      if (blob.file.kind === "stores") {
        const meta = landingCache.get(slug);
        yield* parseVenuePage(
          html,
          slug,
          {
            name: meta?.name ?? slug,
            city: meta?.city ?? null,
            address: meta?.address ?? null,
            lat: meta?.lat ?? null,
            lng: meta?.lng ?? null,
          },
          chainId,
        );
        return;
      }
      yield* parseCategoryPage(html, slug, chainId);
    },
  };
}
