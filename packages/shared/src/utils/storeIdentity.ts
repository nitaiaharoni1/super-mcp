/**
 * Store identity recovery from feed metadata.
 *
 * Several Israeli chains publish a `<StoreName>` but leave `<City>` and
 * `<Address>` empty or literally "unknown" (Yohananof, Keshet Taamim, Salach
 * Dabach). Their store name almost always *is* the locality, sometimes with a
 * neighborhood or mall suffix ("חולון המרכבה", "ירושלים תלפיות", "רעננה").
 * Without a city those rows can never be geocoded (both geocode tiers key on
 * `store.city`) and never match a city filter, so the branch is invisible to
 * every location-scoped query.
 *
 * The same names also mark non-shoppable fulfilment endpoints ("שופרסל ONLINE",
 * "מרלוג אינטרנט", "גדרה פיק אפ", "באר שבע וולט"). Those hold real prices but
 * are not places a shopper can drive to, so they must be classified rather than
 * ranked as branches.
 */
import { canonicalizeCity, extractCityFromLocation, normalizeCityKey } from "./cities.js";
import { scrubNullChars } from "./text.js";

/** What kind of endpoint a `store` row represents. */
export type StoreKind = "branch" | "online" | "pickup" | "warehouse";

/** Every kind a shopper can physically walk into and buy at shelf prices. */
export const SHOPPABLE_STORE_KINDS: readonly StoreKind[] = ["branch"];

/** Every kind that fulfils an order placed on a website rather than at a till. */
export const ONLINE_STORE_KINDS: readonly StoreKind[] = ["online", "pickup"];

/** How a store's prices were acquired. */
export type PriceSource = "feed" | "scraped";

/**
 * Sources that read a website rather than a regulated filing.
 *
 * Declared here, once, so provenance is a property of the source rather than
 * something inferred later from the chain. Inferring it breaks the moment a
 * chain has both: Victory files under the transparency law AND runs a stor.ai
 * storefront, so its scraped online store and its filed branches share a chain
 * id and must still be distinguishable.
 */
const SCRAPED_SOURCE_IDS = new Set(["il-wolt", "il-storai"]);

export function priceSourceForIngestSource(sourceId: string): PriceSource {
  return SCRAPED_SOURCE_IDS.has(sourceId) ? "scraped" : "feed";
}

/**
 * The `<StoreType>` codes the price-transparency schema defines.
 *
 * The regulations' Stores file carries the chain's OWN declaration of what each
 * endpoint is, and every chain we ingest populates it. It was being dropped at
 * parse time, which is why `store_kind` had to be guessed from the store's name
 * and then patched by three separate migrations (023, 024, 028).
 */
export const FEED_STORE_TYPE = {
  /** Physical branch. */
  physical: 1,
  /** Online / e-commerce endpoint: no till, no shopper walks in. */
  online: 2,
  /** Both: a real branch that also fulfils web orders. Shoppable in person. */
  both: 3,
} as const;

/**
 * Store-name-only city abbreviations. Feeds compress the locality inside the
 * branch name ("דיל פ\"ת- אליעזר פרדימן", "שלי ת\"א- נורדאו"). Keys are
 * `normalizeCityKey` output, which strips quotes and gershayim — so `פ"ת`,
 * `פ״ת` and `פת` all arrive here as "פת". These live outside CITY_ALIASES on
 * purpose: two-letter forms are too ambiguous for free-text address parsing,
 * but inside a branch name they are unambiguous.
 */
const STORE_NAME_CITY_ABBREVIATIONS: Record<string, string> = {
  תא: "תל אביב-יפו",
  "ת א": "תל אביב-יפו",
  פת: "פתח תקווה",
  "פ ת": "פתח תקווה",
  בש: "באר שבע",
  "ב ש": "באר שבע",
  רג: "רמת גן",
  "ר ג": "רמת גן",
  כס: "כפר סבא",
  "כ ס": "כפר סבא",
  ראשלצ: "ראשון לציון",
  "ראשל צ": "ראשון לציון",
  רחש: "רמת השרון",
  הוד: "הוד השרון",
  קא: "קריית אתא",
  קמ: "קריית מוצקין",
  מכ: "מודיעין מכבים רעות",
  ירו: "ירושלים",
  נתיב: "נתיבות",
  "מודיעין": "מודיעין מכבים רעות",
};

/**
 * Chain brands and store-format words that precede the locality in a branch
 * name ("שלי הרצליה- הבנים", "קרפור סיטי נוף ים", "יוניברס גלילות רמת השרון").
 * Stripped before locality extraction so a brand token never shadows a city.
 */
const STORE_NAME_NOISE_TOKENS: ReadonlySet<string> = new Set([
  // Chain brands
  "שופרסל",
  "רמי",
  "לוי",
  "יוחננוף",
  "אושר",
  "עד",
  "טיב",
  "טעם",
  "חצי",
  "חינם",
  "ויקטורי",
  "מחסני",
  "השוק",
  "קרפור",
  "סלח",
  "דבאח",
  "פרשמרקט",
  "סטופ",
  "מרקט",
  "קשת",
  "טעמים",
  "carrefour",
  "shufersal",
  // Store formats / banners
  "שלי",
  "דיל",
  "אקספרס",
  "express",
  "יש",
  "בעיר",
  "סיטי",
  "city",
  "יוניברס",
  "היפר",
  "hyper",
  "סופר",
  "super",
  "מרקטים",
  "מיני",
  "mini",
  "כלבו",
  "מגה",
  "פודטראק",
  "מרכז",
  "קניון",
  "מתחם",
  "צומת",
  "ישן",
  "גדול",
  "חדש",
  "store",
]);

// "ליקוט" is order picking: a dark store where staff assemble web orders. Tiv
// Taam files seven, each shadowing a real branch of the same name ("ליקוט רמת
// החייל" beside the actual רמת החייל on דבורה הנביאה 122), all with no address
// and no coordinates. They belong with the other online-fulfilment endpoints,
// not with the warehouses that restock branches. The negative lookahead keeps it
// off words that merely begin with those letters, e.g. "ליקוטי".
const ONLINE_STORE_PATTERN =
  /(online|on\s*line|אונליין|און\s*ליין|אינטרנט|internet|ecom|e-?commerce|וולט|wolt|יאנגו|yango|ten\s*bis|טן\s*ביס|משלוח|ליקוט(?![א-ת]))/i;
const PICKUP_STORE_PATTERN = /(pick\s*-?\s*up|פיק\s*-?\s*אפ|פיקאפ|איסוף|drive\s*-?\s*in)/i;
// No bare "dc": it fires on any name ending in those letters ("אקדח מים DC" read
// as a distribution centre). The remaining patterns already cover the real rows,
// and a mislabelled branch is worse than a missed warehouse.
const WAREHOUSE_STORE_PATTERN = /(מרלוג|מחסן\s|לוגיסטי|logistic|warehouse|מרכז\s*הפצה)/i;

/**
 * True when an address field is nothing but a web address.
 *
 * Some chains file their e-commerce endpoints with the storefront URL in place of
 * a street (Carrefour 472/473). Those are not physical branches. The test has to
 * be "the address is ONLY a URL", not "contains a URL": Keshet 103 is a real shop
 * whose address is "חורב 15 | www.kulinarik.co.il/|", and excluding it would lose
 * a genuine branch.
 */
function isUrlOnlyAddress(address: string | null | undefined): boolean {
  const scrubbed = scrubNullChars(address ?? "").trim();
  if (!scrubbed) return false;
  // Strip separators feeds use to append a URL, then require every remaining
  // token to look like a web address.
  const tokens = scrubbed
    .split(/[\s|,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((token) =>
    /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(token),
  );
}

/**
 * Classify a store row as a shoppable branch or a fulfilment endpoint.
 *
 * `feedStoreType` is the chain's own `<StoreType>` and outranks the name, which
 * is only ever a guess. Measured across every Stores file we hold, the two
 * disagree in both directions:
 *
 *   - "מרלוג אינטרנט" (Rami Levy 039) reads as a warehouse and was classified
 *     one, so its 15,790 prices sat behind the wrong label. The feed calls it
 *     type 2: it is Rami Levy's online store, and belongs in the online product.
 *   - "קולינריק חורב" (Keshet 103) files a URL as part of its address and needed
 *     a hand-written exception in migration 024 to stay a branch. The feed calls
 *     it type 3 — both — which says the same thing without the exception.
 *
 * Precedence within a type-2 endpoint still comes from the name, because the
 * schema has no code for "collect it yourself": a pickup point and a delivery
 * storefront are both type 2 but are different services to a shopper.
 *
 * Type 1 and 3 both mean "a person can walk in", so they suppress the online
 * guess entirely. They do NOT suppress the warehouse guess: the schema has no
 * warehouse code, so a chain filing a distribution centre has to call it type 1,
 * and ranking one as a branch is the exact wasted-trip bug this all exists to
 * prevent.
 *
 * With no feed type, behaviour is unchanged: warehouse → pickup → online → branch.
 */
export function classifyStoreKind(
  name: string | null | undefined,
  address?: string | null | undefined,
  feedStoreType?: number | null | undefined,
): StoreKind {
  const haystack = `${scrubNullChars(name ?? "")} ${scrubNullChars(address ?? "")}`.trim();
  const walkIn =
    feedStoreType === FEED_STORE_TYPE.physical || feedStoreType === FEED_STORE_TYPE.both;

  if (feedStoreType === FEED_STORE_TYPE.online) {
    return PICKUP_STORE_PATTERN.test(haystack) ? "pickup" : "online";
  }
  if (!haystack) return "branch";
  if (WAREHOUSE_STORE_PATTERN.test(haystack)) return "warehouse";
  if (PICKUP_STORE_PATTERN.test(haystack)) return "pickup";
  if (walkIn) return "branch";
  if (ONLINE_STORE_PATTERN.test(haystack)) return "online";
  if (isUrlOnlyAddress(address)) return "online";
  return "branch";
}

/** True when this kind of endpoint may be recommended as a place to shop. */
export function isShoppableStoreKind(kind: StoreKind | null | undefined): boolean {
  // Unknown kind (pre-migration rows) is treated as a branch so an unclassified
  // backlog never silently empties the recommendation pool.
  if (kind == null) return true;
  return kind === "branch";
}

/** Feed placeholders that mean "no address" rather than a real street. */
const PLACEHOLDER_ADDRESS_PATTERN = /^(unknown|n\/?a|none|null|0+|-+|\.+)$/i;

/** True when an address field carries no usable street information. */
export function isPlaceholderAddress(address: string | null | undefined): boolean {
  const scrubbed = scrubNullChars(address ?? "").trim();
  if (!scrubbed) return true;
  return PLACEHOLDER_ADDRESS_PATTERN.test(scrubbed);
}

/** Split a branch name into the segments that may hold a locality. */
function storeNameSegments(name: string): string[] {
  // Feeds separate locality from street/mall with "-", "@", ",", "(" or " - ".
  const segments = name
    .split(/[-–—,@()|/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  // Whole name last: a two-word city ("רמת השרון") can straddle a separator-free
  // name, and the longest-match extractor handles it better than a fragment.
  return [...segments, name];
}

/** Drop chain/format noise tokens so a brand never shadows the locality. */
function stripNoiseTokens(segment: string): string {
  return segment
    .split(/\s+/)
    .filter((token) => {
      const key = normalizeCityKey(token);
      if (!key) return false;
      // Bare digits are store codes ("Store 799", "(4170)"), never localities.
      if (/^\d+$/.test(key)) return false;
      return !STORE_NAME_NOISE_TOKENS.has(key);
    })
    .join(" ");
}

/** Resolve a store-name abbreviation ("פ\"ת") to a canonical locality. */
function localityFromAbbreviation(segment: string): string | null {
  for (const token of segment.split(/\s+/)) {
    const key = normalizeCityKey(token);
    if (key && STORE_NAME_CITY_ABBREVIATIONS[key]) {
      return STORE_NAME_CITY_ABBREVIATIONS[key]!;
    }
  }
  const whole = normalizeCityKey(segment);
  return whole ? (STORE_NAME_CITY_ABBREVIATIONS[whole] ?? null) : null;
}

/**
 * Best-effort locality from a branch name, canonicalized to the same Hebrew
 * form `store.city` uses. Returns null when the name carries no recognizable
 * locality — callers must not invent one.
 *
 * Tries, per name segment (city usually leads, before "-" or the street):
 *   1. the gazetteer via `extractCityFromLocation` (longest whole-token match)
 *   2. store-name-only abbreviations ("פ\"ת" → פתח תקווה)
 * Noise-stripped segments are tried before raw ones so "שלי הרצליה- הבנים"
 * resolves on "הרצליה" rather than on a brand token.
 */
export function localityFromStoreName(name: string | null | undefined): string | null {
  const scrubbed = scrubNullChars(name ?? "").trim();
  if (!scrubbed) return null;
  // A pure placeholder name ("Store 799") carries no locality.
  if (/^store\s*\d+$/i.test(scrubbed)) return null;

  for (const segment of storeNameSegments(scrubbed)) {
    const stripped = stripNoiseTokens(segment);
    for (const candidate of [stripped, segment]) {
      if (!candidate) continue;
      const fromGazetteer = extractCityFromLocation(candidate);
      if (fromGazetteer) return fromGazetteer;
      const fromAbbreviation = localityFromAbbreviation(candidate);
      if (fromAbbreviation) return fromAbbreviation;
    }
  }
  return null;
}

/**
 * The city to store for a feed record: the feed's own city when it carries one,
 * otherwise the locality recovered from the branch name. Returns undefined when
 * neither yields a locality, matching `canonicalizeCity`'s absent contract.
 */
export function resolveStoreCity(
  feedCity: string | null | undefined,
  storeName: string | null | undefined,
): string | undefined {
  const fromFeed = canonicalizeCity(feedCity);
  if (fromFeed) return fromFeed;
  const fromName = localityFromStoreName(storeName);
  return fromName ?? undefined;
}
