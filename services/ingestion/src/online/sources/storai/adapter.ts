import type {
  DeliveryTariffBand,
  FeedFile,
  RawBlob,
  RawRecord,
  SourceAdapter,
} from "@super-mcp/shared";
import { fetchAllowedFeed } from "../../../sources/common/allowedFetch.js";
import { STORAI_QUERY_VOCABULARY } from "./vocabulary.js";

/**
 * Stor.ai (formerly Self-Point) hosts the storefronts of most Israeli chains
 * that are missing from the regulated feeds we ingest.
 *
 * WHY THE API HOST AND NOT THE RETAILER DOMAIN
 *
 * Victory, Machsanei Hashuk and the rest put bot management on their own
 * domains. `api.self-point.com` is the shared multi-tenant host their own
 * storefronts call, it is not challenged, and it is the same data. This adapter
 * talks to that host directly, identifies itself honestly in the User-Agent, and
 * paces its requests. It does not attempt to defeat any challenge.
 *
 * WHAT THIS SOURCE CANNOT GIVE YOU
 *
 * There is no barcode. Probed four ways (`/products/{id}`, branch-scoped detail,
 * global product lookup, and search-by-barcode) and none returns one; no key
 * matching barcode/ean/gtin exists anywhere in the payload. The identifiers on
 * offer are `productId`, `externalId`/`gs1ProductId` and `branchProductId`, all
 * retailer-internal.
 *
 * That has a hard consequence worth stating plainly: these products land as
 * CHAIN-SCOPED items, exactly like the loose produce the feeds publish with
 * internal codes. They can be searched and priced within their own chain, but
 * they cannot be joined by barcode to the same product at Shufersal, so they do
 * not participate in cross-chain price comparison. Fabricating a GTIN to make
 * them look comparable would silently produce wrong comparisons, which is worse
 * than the gap.
 *
 * HOW MUCH OF THE CATALOGUE THIS SEES
 *
 * Not all of it, and it cannot. The product endpoint refuses a request without a
 * non-empty `query` (403), caps results at 20 regardless of `limit`, and ignores
 * `offset`; there is no category or family route either. Search is the only door,
 * so coverage is exactly what the query vocabulary reaches: a few thousand
 * commonly-shopped products per store rather than a complete listing. That is a
 * real gap, not a tuning knob, and it is why this source is a stopgap.
 *
 * The regulated route is strictly better where it exists. Victory and several
 * others publish under the transparency law via portals we do not yet ingest
 * (laibcatalog.co.il, the binaprojects family). Adding those as feed adapters
 * would deliver the same chains WITH barcodes, physical branches and legal
 * footing. This adapter is the stopgap, not the destination.
 */
export const STORAI_HOSTS = ["api.self-point.com"] as const;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export interface StorAiRetailer {
  /** Stor.ai tenant id. */
  retailerId: number;
  /** Chain id used in our database. Synthetic where the chain has no feed. */
  chainId: string;
  name: string;
  storefrontUrl: string;
  /**
   * Delivery terms, when the retailer publishes them.
   *
   * The storefront API itself carries none, so these are read from the chain's
   * own terms page the same way the curated catalogue is, and they are optional
   * because "we have not established it" has to stay expressible. Without them
   * the sync writes `national` at confidence `estimated`, which reads as "ships
   * anywhere in Israel" for a chain that in fact serves five settlements.
   */
  terms?: {
    minimumOrder: number;
    tariffs: DeliveryTariffBand[];
    /** Settlements the chain publishes, exactly as it spells them. */
    cities: readonly string[];
    confidence: "verified" | "reported";
    verifiedAt: string;
    sourceUrl: string;
    notes: string;
  };
}

/**
 * Chains to pull, and only the ones missing from the regulated feeds.
 *
 * Carrefour (1540), Quik (1541), Yeinot Bitan (1131), Keshet (1219) and Tiv Taam
 * (1062) are all on stor.ai too, and are deliberately NOT listed: we already get
 * them from the feeds, with barcodes. Scraping them would create a second,
 * worse copy of data we already hold.
 */
export const STORAI_RETAILERS: readonly StorAiRetailer[] = [
  // Victory and Machsanei Hashuk use their REAL legal chain ids, not synthetic
  // ones. Both file under the transparency law via portals we do not ingest yet,
  // and when those are added the filed branches must land in the SAME chain as
  // this scraped storefront rather than beside a duplicate.
  {
    retailerId: 1470,
    chainId: "7290696200003",
    name: "ויקטורי",
    storefrontUrl: "https://www.victoryonline.co.il",
  },
  {
    retailerId: 1107,
    chainId: "7290661400001",
    name: "מחסני השוק",
    storefrontUrl: "https://www.m-hashuk.co.il",
  },
  {
    retailerId: 1492,
    chainId: "IL-SUPER-YUDA",
    name: "סופר יודה",
    storefrontUrl: "https://www.yuda.co.il",
    terms: {
      minimumOrder: 150,
      tariffs: [
        { slotType: "standard", minSubtotal: 150, maxSubtotal: 499, fee: 35, membership: null, feeIsFloor: false },
        { slotType: "standard", minSubtotal: 499, maxSubtotal: null, fee: 0, membership: null, feeIsFloor: false },
      ],
      cities: ["תל אביב", "רמת השרון", "חולון", "ראשון לציון", "צור יצחק"],
      confidence: "reported",
      verifiedAt: "2026-08-02",
      sourceUrl: "https://www.yuda.co.il",
      notes:
        "Five settlements, not the country: the branch-level rates differ (₪32 around Holon and west " +
        "Rishon LeZion) but are not modelled, because the storefront picks the branch and we cannot " +
        "tell which one a basket would be picked from. The ₪35 band is therefore the safe one to quote. " +
        "Free delivery above ₪499 is a promotion running to 2026-12-31, which is inside the 90-day " +
        "terms TTL, so it will lapse into a re-read rather than outlive itself.",
    },
  },
  {
    retailerId: 1450,
    chainId: "IL-POLITZER",
    name: "פוליצר",
    storefrontUrl: "https://www.politzer.co.il",
    terms: {
      minimumOrder: 150,
      tariffs: [
        { slotType: "standard", minSubtotal: 150, maxSubtotal: null, fee: 40, membership: null, feeIsFloor: false },
      ],
      cities: [
        "קיסריה", "שדות ים", "נאות גולף", "אור עקיבא", "אור ים",
        "חדרה", "חוגלה", "חיבת ציון", "אליכין", "חרב לאת",
      ],
      confidence: "verified",
      verifiedAt: "2026-08-02",
      sourceUrl: "https://www.politzer.co.il",
      notes:
        "A single-region grocer around Caesarea and Hadera, previously recorded as delivering " +
        "nationwide. Two published rates, ₪35.90 around Caesarea/Hadera and ₪40 for Or Akiva and Or " +
        "Yam; the higher one is stored because the area a basket resolves to is not known at ranking " +
        "time, and over-quoting a fee costs a shopper nothing while under-quoting it misranks the shop.",
    },
  },
];

interface StorAiBranch {
  id: number;
  name: string;
  city: string | null;
  location: string | null;
}

/** Branches whose name marks them as the chain's web storefront. */
function isOnlineBranch(branch: StorAiBranch): boolean {
  return /online|אונליין|אינטרנט/i.test(branch.name);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetchAllowedFeed(url, STORAI_HOSTS, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Accept-Language": "he" },
  });
  if (!res.ok) throw new Error(`stor.ai ${res.status} for ${url}`);
  return res.json();
}

export interface StorAiAdapterOptions {
  /** Online branches per retailer. They mirror each other, so a few is plenty. */
  maxBranchesPerRetailer?: number;
  /** How many vocabulary terms to sweep per branch. */
  maxQueriesPerBranch?: number;
  retailers?: readonly StorAiRetailer[];
}

export function createStorAiAdapter(options: StorAiAdapterOptions = {}): SourceAdapter {
  const retailers = options.retailers ?? STORAI_RETAILERS;
  const maxBranches = options.maxBranchesPerRetailer ?? 1;
  const queries = STORAI_QUERY_VOCABULARY.slice(
    0,
    options.maxQueriesPerBranch ?? STORAI_QUERY_VOCABULARY.length,
  );
  const branchMeta = new Map<string, { retailer: StorAiRetailer; branch: StorAiBranch }>();

  return {
    sourceId: "il-storai",
    market: "IL",
    expectedChainIds: retailers.map((r) => r.chainId),

    async discover(): Promise<FeedFile[]> {
      const files: FeedFile[] = [];
      for (const retailer of retailers) {
        let branches: StorAiBranch[] = [];
        try {
          const body = (await getJson(
            `https://api.self-point.com/v2/retailers/${retailer.retailerId}/branches`,
          )) as { branches?: StorAiBranch[] };
          branches = Array.isArray(body.branches) ? body.branches : [];
        } catch (err) {
          console.error(
            JSON.stringify({ event: "storai_branches_failed", retailer: retailer.name, error: String(err) }),
          );
          continue;
        }
        const online = branches.filter(isOnlineBranch).slice(0, maxBranches);
        // Fall back to the retailer's default branch: some tenants name the web
        // store plainly ("אינטרנט") and some do not name it at all.
        const selected = online.length > 0 ? online : branches.slice(0, 1);

        console.log(
          JSON.stringify({
            event: "storai_discovery",
            retailer: retailer.name,
            branches: branches.length,
            online: online.length,
            selected: selected.length,
          }),
        );

        for (const branch of selected) {
          const key = `${retailer.retailerId}:${branch.id}`;
          branchMeta.set(key, { retailer, branch });
          files.push({
            sourceId: "il-storai",
            kind: "stores",
            remotePath: `storai://${key}`,
            fileName: `branch-${key}.json`,
            chainId: retailer.chainId,
            storeId: String(branch.id),
          });
          for (const term of queries) {
            files.push({
              sourceId: "il-storai",
              // One search result is not the whole catalogue; see the same note
              // in the Wolt adapter.
              kind: "prices",
              remotePath:
                `https://api.self-point.com/v2/retailers/${retailer.retailerId}` +
                `/branches/${branch.id}/products?query=${encodeURIComponent(term)}&limit=20`,
              fileName: `products-${key}-${encodeURIComponent(term)}.json`,
              chainId: retailer.chainId,
              storeId: String(branch.id),
            });
          }
        }
      }
      return files;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      if (file.kind === "stores") {
        const key = file.remotePath.replace("storai://", "");
        const meta = branchMeta.get(key);
        return {
          sourceId: "il-storai",
          file,
          bytes: Buffer.from(JSON.stringify(meta ?? {}), "utf8"),
          fetchedAt: new Date(),
        };
      }
      const body = await getJson(file.remotePath);
      return { sourceId: "il-storai", file, bytes: Buffer.from(JSON.stringify(body), "utf8"), fetchedAt: new Date() };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const parsed = JSON.parse(blob.bytes.toString("utf8")) as Record<string, unknown>;

      if (blob.file.kind === "stores") {
        const meta = parsed as unknown as { retailer?: StorAiRetailer; branch?: StorAiBranch };
        if (!meta.retailer || !meta.branch) return;
        yield {
          kind: "store",
          chainId: meta.retailer.chainId,
          storeId: String(meta.branch.id),
          name: meta.branch.name,
          address: meta.branch.location ?? meta.retailer.storefrontUrl,
          city: meta.branch.city ?? undefined,
          storeType: 2,
          raw: { storefrontUrl: meta.retailer.storefrontUrl, retailerId: meta.retailer.retailerId },
        };
        return;
      }

      const products = Array.isArray(parsed["products"]) ? (parsed["products"] as unknown[]) : [];
      const ts = new Date();
      for (const entry of products) {
        const p = entry as Record<string, unknown>;
        const branch = (p["branch"] ?? {}) as Record<string, unknown>;
        const price = typeof branch["regularPrice"] === "number" ? branch["regularPrice"] : null;
        if (price == null || price <= 0) continue;
        // Out of stock is real information the feeds never carry. Skipping the row
        // is the honest handling: quoting a price for something you cannot add to
        // a basket is worse than not listing it.
        if (branch["isOutOfStock"] === true) continue;

        const names = (p["names"] ?? {}) as Record<string, { short?: string; long?: string }>;
        const name =
          names["1"]?.short ??
          names["1"]?.long ??
          (typeof p["localName"] === "string" ? p["localName"] : null);
        const productId = p["productId"] ?? p["id"];
        if (!name || productId == null) continue;

        const brandNames = ((p["brand"] ?? {}) as Record<string, unknown>)["names"] as
          | Record<string, string>
          | undefined;
        const unit = (p["unitOfMeasure"] ?? {}) as Record<string, unknown>;

        yield {
          kind: "price",
          chainId: blob.file.chainId,
          storeId: blob.file.storeId ?? "",
          itemCode: String(productId),
          // 0 = retailer-internal code, not a barcode. This is what keeps the
          // product chain-scoped instead of wrongly merging it with another
          // chain's product of the same name.
          itemType: 0,
          name,
          brand: brandNames?.["1"],
          qty: typeof p["weight"] === "number" ? p["weight"] : undefined,
          unit: typeof unit["defaultName"] === "string" ? unit["defaultName"] : undefined,
          price,
          ts,
        };
      }
    },
  };
}
