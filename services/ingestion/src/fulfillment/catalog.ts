/**
 * Delivery terms for every online storefront we can price a basket at.
 *
 * WHY THIS IS A FILE AND NOT A SCRAPER
 *
 * Item prices come from the regulated feeds: published daily, machine-readable,
 * legally required to be accurate. Delivery terms have none of those properties.
 * Shufersal and Rami Levy state their fee as a sentence inside a תקנון; the
 * slot picker sits behind an address and a login. There is no endpoint to poll.
 * So this half is a human reading a terms page, and the only defensible way to
 * ship that is to make the reading auditable: every number below carries the URL
 * it came from, the date it was read, and how much to trust it.
 *
 * `verifiedAt` is not decoration. Rami Levy held ₪29.90 for fifteen years and
 * then raised it 20% in a single month; a table nobody has re-read since spring
 * looks fine, parses fine and quietly lies. `SERVICE_TERMS_TTL_DAYS` is what
 * turns an unchecked row back into "fee unknown" instead of a confident wrong
 * number.
 *
 * SCOPE
 *
 * Only storefronts whose PRICES we hold are listed. A storefront we cannot price
 * would let the optimiser claim a total it cannot support. Chains missing from
 * this file and why: Hazi Hinam, am:pm, Osher Ad, Stop Market and Fresh Market
 * file no online <StoreType>2 endpoint with prices in the feeds at all, and
 * Yochananof files three pickup points that carry zero price rows.
 *
 * Victory and Machsanei Hashuk were in that list until the laibcatalog portal
 * was connected, and are the reason to re-read it whenever a source is added.
 * Both had been standing in with a stor.ai scrape of the same storefront, which
 * carries no barcode on any item, so neither could be compared against another
 * chain at all. Their filings hold the same shops with barcodes on ~88% of rows,
 * and Machsanei Hashuk turned out to file a second, Eilat-only online endpoint
 * nobody had noticed. A chain that "publishes nothing" is worth re-checking; it
 * usually means we had not found where.
 *
 * REFRESHING
 *
 *   pnpm ingest:fulfillment          re-reads this file into the database
 *
 * Change a number, change its `verifiedAt` in the same edit. A stale date next to
 * a fresh number is worse than either alone.
 */
import type { TermsConfidence } from "@super-mcp/shared";
import {
  CARREFOUR_SETTLEMENTS,
  MACHSANEI_SETTLEMENTS,
  POLITZER_SETTLEMENTS,
  QUIK_SETTLEMENTS,
  RAMI_LEVY_SETTLEMENTS,
  SUPER_YUDA_SETTLEMENTS,
  TIV_TAAM_ASHDOD,
  TIV_TAAM_BEER_SHEVA,
  TIV_TAAM_HAIFA,
  TIV_TAAM_NETANYA,
  TIV_TAAM_RAMAT_HAHAYAL,
  TIV_TAAM_RISHON,
  VICTORY_SETTLEMENTS,
  YEINOT_BITAN_SETTLEMENTS,
} from "./deliveryAreas.js";

export interface CatalogTariffBand {
  slotType?: string;
  minSubtotal?: number;
  maxSubtotal?: number;
  fee: number;
  membership?: string;
  /** True when `fee` is a published lower bound rather than the charge. */
  feeIsFloor?: boolean;
}

export interface CatalogCoverage {
  scope: "national" | "city" | "radius" | "polygon";
  cityKey?: string;
  centerLat?: number;
  centerLng?: number;
  radiusKm?: number;
  confidence: TermsConfidence;
}

export interface CatalogService {
  slug: string;
  chainId: string;
  /** `store.store_code` of the feed's online row this priced catalogue lives in. */
  storeCode: string;
  brand: string;
  serviceType: "delivery" | "pickup" | "marketplace";
  marketplace?: string;
  storefrontUrl?: string;
  minimumOrder?: number;
  /** False when we simply have not established whether a minimum exists. */
  minimumOrderKnown?: boolean;
  serviceFee?: { percent: number; min: number; max: number };
  tariffs: CatalogTariffBand[];
  coverage: CatalogCoverage[];
  termsConfidence: TermsConfidence;
  /** ISO date the terms above were last read from the source. */
  verifiedAt?: string;
  sourceUrl?: string;
  notes?: string;
  active?: boolean;
}

const SHUFERSAL = "7290027600007";
const RAMI_LEVY = "7290058140886";
const CARREFOUR = "7290055700007";
const TIV_TAAM = "7290873255550";
const KESHET = "7290785400000";
const VICTORY = "7290696200003";
const MACHSANEI_HASHUK = "7290661400001";

/**
 * How long a hand-checked figure may be quoted before it decays to "unknown".
 *
 * 90 days is chosen against the observed failure: the two largest chains both
 * moved from ₪29.90 to ₪35.90 within about two months of each other in 2026, so
 * a quarter is the longest window in which being silently wrong stays a small
 * error rather than a ₪6 one.
 */
export const SERVICE_TERMS_TTL_DAYS = 90;

/**
 * A retailer's published settlement list as one coverage rule per name.
 *
 * `evaluateCoverage` ORs the rules and keeps the strongest confidence that
 * matched, so a list behaves as "serves any of these" without needing a new
 * scope. Storing the retailer's own spelling is deliberate: matching runs
 * through `canonicalizeCity`, which already knows "תל אביב-יפו" and "תל אביב"
 * are one place.
 */
function servedSettlements(
  cities: readonly string[],
  confidence: TermsConfidence,
): CatalogCoverage[] {
  return cities.map((cityKey) => ({ scope: "city" as const, cityKey, confidence }));
}

/**
 * Where the stor.ai chains' terms come from.
 *
 * Victory, Tiv Taam, Carrefour, Quik, Yeinot Bitan, Machsanei Hashuk and
 * Freshmarket all run their storefronts on stor.ai, which publishes each
 * retailer's fee table as a static configuration file. That is a far better
 * source than a terms page: it is the same object the checkout reads, so the
 * numbers match what a shopper is actually charged.
 */
const STOR_AI_CONFIG_NOTE = "https://www.stor.ai (storefront configuration, per retailer)";

export const FULFILLMENT_CATALOG: CatalogService[] = [
  // ---------------------------------------------------------------- Shufersal
  {
    slug: "shufersal-online",
    chainId: SHUFERSAL,
    storeCode: "413",
    brand: "שופרסל ONLINE",
    serviceType: "delivery",
    storefrontUrl: "https://www.shufersal.co.il/online",
    // The תקנון states no minimum-order clause. Read as an absence, not a gap:
    // the document is exhaustive about the other charges.
    minimumOrder: undefined,
    minimumOrderKnown: true,
    tariffs: [
      // תקנון §37: "בנוסף למחירי המוצרים יחויב הלקוח בדמי משלוח בסך 35.90 ש"ח".
      // Raised ~20% from ₪29.90 during 2026.
      { fee: 35.9 },
      // §39: click-and-collect is NOT free — ₪15, dropping to ₪10 above ₪750.
      { slotType: "pickup", maxSubtotal: 750, fee: 15 },
      { slotType: "pickup", minSubtotal: 750, fee: 10 },
    ],
    coverage: [{ scope: "national", confidence: "reported" }],
    termsConfidence: "verified",
    verifiedAt: "2026-08-01",
    sourceUrl: "https://www.shufersal.co.il/online/he/regu-online",
    notes:
      "Delivery ₪35.90 and the pickup tiers are quoted verbatim from the binding תקנון (§37, §39). " +
      "A failed delivery (nobody home, wrong address) carries a further handling fee of ₪50 up to " +
      "₪500 of goods, ₪70 to ₪1,000, ₪100 above (§38א.3) — not modelled, since it is not a cost of " +
      "a successful order. Orders are editable up to 12h before the slot (§§35, 55). Shufersal's own " +
      "terms concede that online prices differ from shelf prices, attributing it to שיטות ליקוט שונות " +
      "(§20 / Appendix A §5), which is why this storefront's own feed prices are used and never a " +
      "branch's. National coverage is the chain's operating footprint, not a published settlement list.",
  },

  // ---------------------------------------------------------------- Rami Levy
  {
    slug: "rami-levy-online",
    chainId: RAMI_LEVY,
    storeCode: "039",
    brand: "רמי לוי אונליין",
    serviceType: "delivery",
    storefrontUrl: "https://www.rami-levy.co.il/he/online",
    minimumOrder: undefined,
    minimumOrderKnown: true,
    tariffs: [
      // "עלות המשלוח - 35.90 ש"ח", read live from the chain's own deliveries page.
      { fee: 35.9 },
      // Rami Levy credit-card holders kept the pre-rise rate. Reported by Ynet,
      // not stated on the chain's page, so it is membership-gated and flagged —
      // the same treatment a clubOnly shelf price gets, one layer up.
      { fee: 29.9, membership: "credit_card" },
    ],
    // Was `national` at confidence `verified` — the strongest claim the schema can
    // make, and the note below said in as many words that it answers yes to
    // shoppers the chain does not reach. The list it describes is 270 named
    // settlements, so it is now stored as the list it always was.
    coverage: servedSettlements(RAMI_LEVY_SETTLEMENTS, "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-02",
    sourceUrl: "https://www.rami-levy.co.il/he/orders-and-deliveries",
    notes:
      "₪35.90 read from the chain's own deliveries page. Raised from ₪29.90 in May 2026, which the " +
      "chain described as its first increase in fifteen years. Coverage is the 270 settlements that " +
      "page publishes under \"אלו הם רשימת ישובים אליהם מגיעים המשלוחים\", grouped into 14 regions. " +
      "The chain's FAQ states there is NO minimum order (\"ללא סכום הגבלה מסוים להזמנה\"); a ₪50 floor " +
      "does exist in the shipped checkout code but every call site is gated on the mall cart, not the " +
      "grocery one, so it does not apply here. Two published restrictions are not modelled: no " +
      "delivery above the 5th floor without a lift, and none to addresses without vehicle access.",
  },

  // ---------------------------------------------------------------- Carrefour
  {
    slug: "carrefour-online",
    chainId: CARREFOUR,
    storeCode: "471",
    brand: "קרפור אונליין",
    serviceType: "delivery",
    storefrontUrl: "https://www.carrefour.co.il",
    minimumOrder: 200,
    minimumOrderKnown: true,
    tariffs: [
      { fee: 35.9 },
      { slotType: "pickup", fee: 15 },
    ],
    coverage: servedSettlements(CARREFOUR_SETTLEMENTS, "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-01",
    sourceUrl: STOR_AI_CONFIG_NOTE,
    notes:
      "₪35.90 delivery, ₪200 minimum and ₪15 pickup read from Carrefour's own stor.ai storefront " +
      "configuration. Slots are 2-hour windows from next day. This storefront's feed prices average " +
      "7.8% BELOW its own physical branches, which is why its own rows are priced and never a " +
      "branch's. Coverage is recorded as national with LOW confidence: one undated secondary source " +
      "lists a settlement list that excludes Tel Aviv, and the storefront configuration does not " +
      "confirm it. Asserting a refusal we cannot support would hide the cheapest option in the set, " +
      "so the doubt lives here rather than in a coverage rule.",
  },
  {
    slug: "quik",
    chainId: CARREFOUR,
    storeCode: "473",
    brand: "קוויק",
    serviceType: "delivery",
    storefrontUrl: "https://www.quik.co.il",
    minimumOrder: 200,
    minimumOrderKnown: true,
    tariffs: [
      { fee: 29.9 },
      { slotType: "pickup", fee: 15 },
    ],
    coverage: servedSettlements(QUIK_SETTLEMENTS, "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-01",
    sourceUrl: STOR_AI_CONFIG_NOTE,
    notes:
      "₪29.90 delivery, ₪200 minimum and ₪15 pickup from the storefront's own stor.ai configuration. " +
      "Express-delivery brand filed under the Carrefour chain id; since 2023 it has sat inside " +
      "Electra Consumer Products, the same group as Yeinot Bitan. Its feed prices track Carrefour " +
      "branch 002 at 99.2% identical, with produce about ₪1 dearer.",
  },
  {
    slug: "yeinot-bitan-online",
    chainId: CARREFOUR,
    storeCode: "472",
    brand: "יהלומים ביתן",
    serviceType: "delivery",
    storefrontUrl: "https://www.ybitan.co.il",
    minimumOrder: 200,
    minimumOrderKnown: true,
    tariffs: [
      { fee: 29.9 },
      { slotType: "pickup", fee: 15 },
    ],
    coverage: servedSettlements(YEINOT_BITAN_SETTLEMENTS, "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-01",
    sourceUrl: STOR_AI_CONFIG_NOTE,
    notes:
      "₪29.90 delivery, ₪200 minimum and ₪15 pickup from the storefront's own stor.ai configuration. " +
      "Yeinot Bitan storefront filed under the Carrefour chain id; 98.6% price-identical to " +
      "Carrefour branch 002.",
  },

  // ------------------------------------------------------------------ Victory
  {
    slug: "victory-online",
    chainId: VICTORY,
    // The filed <StoreType>2 endpoint, not the stor.ai scrape of the same shop.
    // Same storefront, 8,525 items against 2,228, and 7,563 barcodes against none
    // — without a barcode a price cannot be compared to any other chain, which is
    // the entire point of holding it.
    storeCode: "097",
    brand: "ויקטורי אונליין",
    serviceType: "delivery",
    storefrontUrl: "https://www.victoryonline.co.il",
    minimumOrder: 250,
    minimumOrderKnown: true,
    tariffs: [{ minSubtotal: 250, fee: 35.9 }],
    coverage: servedSettlements(VICTORY_SETTLEMENTS, "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-02",
    sourceUrl: "https://www.victoryonline.co.il/terms-and-conditions",
    notes:
      "₪250 minimum and ₪35.90 delivery read from Victory's own terms page. The published area list " +
      "also names 18 region phrases (\"ישובי עמק חפר\", \"קרית מלאכי והסביבה\") that resolve to no single " +
      "settlement and are not stored, so coverage is the concrete subset and a shopper in one of those " +
      "villages is wrongly told no rather than wrongly told yes.",
  },

  // --------------------------------------------------------- Machsanei Hashuk
  {
    slug: "machsanei-hashuk-online",
    chainId: MACHSANEI_HASHUK,
    storeCode: "097",
    brand: "מחסני השוק אונליין",
    serviceType: "delivery",
    storefrontUrl: "https://www.mck.co.il",
    minimumOrder: 250,
    minimumOrderKnown: true,
    tariffs: [{ minSubtotal: 250, fee: 38.9 }],
    coverage: servedSettlements(MACHSANEI_SETTLEMENTS, "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-02",
    sourceUrl: "https://www.mck.co.il/terms-and-conditions",
    notes:
      "The storefront is mck.co.il, not the m-hashuk.co.il the scraper had been pointed at. Its area " +
      "list is weighted to the south and Jerusalem, matching where the branches are.",
  },
  {
    // A SECOND filed online endpoint, and a genuinely separate shop: Eilat is
    // outside the mainland delivery area and carries its own cheaper fee. It had
    // been sitting in the feed unused, so every Eilat basket saw no Machsanei
    // Hashuk option at all.
    slug: "machsanei-hashuk-online-eilat",
    chainId: MACHSANEI_HASHUK,
    storeCode: "096",
    brand: "מחסני השוק אונליין (אילת)",
    serviceType: "delivery",
    storefrontUrl: "https://www.mck.co.il",
    minimumOrder: 250,
    minimumOrderKnown: true,
    tariffs: [{ minSubtotal: 250, fee: 33 }],
    coverage: servedSettlements(["אילת"], "verified"),
    termsConfidence: "verified",
    verifiedAt: "2026-08-02",
    sourceUrl: "https://www.mck.co.il/terms-and-conditions",
    notes:
      "Eilat only, ₪33 rather than the ₪38.90 charged on the mainland. Priced from its own filing, so " +
      "the free-trade-zone VAT exemption is already in the item prices rather than needing modelling.",
  },

  // ----------------------------------------------------------------- Tiv Taam
  //
  // Seven regional picking depots, each shadowing a real branch. Unlike the
  // single national storefronts above, WHICH depot serves a shopper depends on
  // where they live, so each carries its own radius. The radius is estimated:
  // Tiv Taam publishes no service map, and seven depots covering the country
  // implies roughly this reach. It is recorded as estimated so the answer can be
  // hedged rather than asserted.
  ...(
    [
      { code: "519", name: "ליקוט רמת החייל", lat: 32.1093, lng: 34.8367, cities: TIV_TAAM_RAMAT_HAHAYAL },
      { code: "514", name: "ליקוט ראשון מזרח", lat: 31.9730, lng: 34.8060, cities: TIV_TAAM_RISHON },
      { code: "502", name: "ליקוט נתניה", lat: 32.3215, lng: 34.8532, cities: TIV_TAAM_NETANYA },
      { code: "503", name: "ליקוט טיב טעם אשדוד", lat: 31.8014, lng: 34.6435, cities: TIV_TAAM_ASHDOD },
      { code: "512", name: "ליקוט טיב טעם קריות", lat: 32.8340, lng: 35.0800, cities: TIV_TAAM_HAIFA },
      { code: "515", name: "ליקוט טיב באר שבע", lat: 31.2518, lng: 34.7913, cities: TIV_TAAM_BEER_SHEVA },
      // Caesarea publishes no delivery list of its own; it is a pickup point, and
      // the radius stands in only so the depot is testable at all.
      { code: "523", name: "ליקוט קיסריה", lat: 32.5000, lng: 34.9000, cities: [] as readonly string[] },
    ] as const
  ).map<CatalogService>((depot) => ({
    slug: `tiv-taam-${depot.code}`,
    chainId: TIV_TAAM,
    storeCode: depot.code,
    brand: `טיב טעם אונליין (${depot.name.replace("ליקוט ", "")})`,
    serviceType: "delivery",
    storefrontUrl: "https://www.tivtaam.co.il",
    minimumOrder: 300,
    minimumOrderKnown: true,
    tariffs: [
      // ₪29.90 and the ₪300 minimum come from Tiv Taam's own stor.ai storefront
      // configuration — the object its checkout reads. Chain-wide, so every depot
      // carries the same schedule. A widely reported "free above ₪750" tier is
      // NOT in that configuration and is deliberately not encoded: a free tier we
      // invented would produce confident "spend ₪40 more and save ₪29.90" advice
      // that is simply wrong.
      { fee: 29.9 },
      { slotType: "pickup", fee: 15 },
    ],
    // Each depot publishes the settlements it serves, so the guessed 30km circles
    // are gone: they both over-reached (a 30km ring from Ramat HaHayal covers
    // Ashdod, which that depot does not serve) and under-reached (Netanya's own
    // list runs to 78 settlements). The radius survives only where a depot
    // publishes nothing.
    coverage:
      depot.cities.length > 0
        ? servedSettlements(depot.cities, "verified")
        : [
            {
              scope: "radius",
              centerLat: depot.lat,
              centerLng: depot.lng,
              radiusKm: 30,
              confidence: "estimated",
            },
          ],
    termsConfidence: "verified",
    verifiedAt: "2026-08-01",
    sourceUrl: STOR_AI_CONFIG_NOTE,
    notes:
      "₪29.90 delivery, ₪300 minimum and ₪15 pickup from Tiv Taam's own stor.ai storefront " +
      "configuration; slots run to 2 hours, bookable six days ahead. " +
      "The 30 km radius is an estimate, not a published service area: the chain files " +
      "seven regional picking depots and no service map, so which one covers a shopper is inferred " +
      "from where the depot is. These depots price at 99% identical to the chain's own shelf prices, " +
      "so unlike the other storefronts here the shelf price is a good guide to what the goods cost.",
  })),

  // ------------------------------------------------------------ Keshet / Wolt
  {
    slug: "keshet-wolt-beer-sheva",
    chainId: KESHET,
    storeCode: "318",
    brand: "קשת טעמים באר שבע (Wolt)",
    serviceType: "marketplace",
    marketplace: "wolt",
    storefrontUrl: "https://wolt.com/he/isr",
    // Verified across 60 Israeli grocery venues: ₪70 is the standard Wolt
    // grocery minimum, with occasional ₪50–₪60 exceptions.
    minimumOrder: 70,
    minimumOrderKnown: true,
    // דמי תפעול, quoted from Wolt's own venue payload: 5% of the PRE-DISCOUNT
    // item total, floored at ₪1.00 and capped at ₪5.90. Their terms say
    // explicitly that discounts are not counted: "הנחות ומבצעים לא ילקחו בחשבון".
    serviceFee: { percent: 5, min: 1, max: 5.9 },
    tariffs: [
      // delivery_base_price = 1000 agorot. This is the base at zero distance;
      // the final figure rises with distance and is only computed at checkout
      // against a real address, so it is a floor, not the price.
      { fee: 10, feeIsFloor: true },
      // Wolt+ (₪29/month as of March 2026, cut from ₪49) carries free grocery
      // delivery above a ₪140 basket. Gated on the membership so a shopper
      // without the subscription is never quoted it.
      { minSubtotal: 140, fee: 0, membership: "wolt_plus" },
    ],
    coverage: [
      // Wolt publishes a real ~45-vertex polygon per venue. Until it is captured
      // this is the radius its Beer Sheva polygon spans.
      {
        scope: "radius",
        centerLat: 31.2518,
        centerLng: 34.7913,
        radiusKm: 8,
        confidence: "estimated",
      },
    ],
    termsConfidence: "verified",
    verifiedAt: "2026-08-01",
    sourceUrl: "https://wolt.com/he/isr",
    notes:
      "A marketplace, and it prices like one. This storefront's own feed rows run +25% against the " +
      "chain's shelf prices — the largest online-versus-shelf gap of any endpoint we hold, and the " +
      "reason marketplace is a distinct service_type. A wider check of 15 GTINs at a Shufersal-on-Wolt " +
      "venue found Wolt never cheaper than the source branch and dearer on 9 of 15, about +5% on the " +
      "basket; price-controlled staples (מוצרים בפיקוח) match to the agora everywhere. ₪10 is the base " +
      "fee at zero distance, so the real fee is this or more, never less. A paid priority tier " +
      "(דמי עדיפות) and the pickup fee exist in the product but are not exposed before checkout.",
  },
];
