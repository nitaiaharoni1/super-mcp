/**
 * Ingest coverage: Greater Tel Aviv / coastal central (Rishon–Netanya),
 * plus Jerusalem, Haifa, and Beersheva metros.
 *
 * Store selection for PriceFull/PromoFull is limited to these areas.
 * Disable with SUPER_MCP_REGION_FILTER=0 for debugging.
 */

import {
  classifyStoreKind,
  coveredLocalityCodes,
  localityFromStoreName,
  normalizeCityKey,
  parseLocalityCode,
  type RawStoreRecord,
} from "@super-mcp/shared";

export interface StoreLocationHint {
  storeId: string;
  city?: string;
  lat?: number;
  lng?: number;
  /** Optional free-text (store name) used as a weak city hint. */
  name?: string;
  /** The store's street address, when the feed gives one. */
  address?: string;
  /**
   * The chain's own `<StoreType>` from the Stores file.
   *
   * Carried through discovery, not just into the store row, because the online
   * filter has to decide whether to download a PriceFull file before anything
   * has been parsed out of it. `classifyStoreKind` treats it as outranking the
   * name, which is the whole reason Rami Levy's "מרלוג אינטרנט" is an online
   * store and not the warehouse it reads as.
   */
  storeType?: number;
  /**
   * A kind already decided elsewhere (the store row), which outranks re-deriving
   * one. Set only by the database fallback, where the classification has already
   * been made and stored.
   */
  storeKind?: string | null;
  /**
   * True for a storefront that delivers rather than one a shopper drives to.
   *
   * The region filter answers "which BRANCHES are worth refreshing near our
   * users". It is the wrong question for a delivery depot: where the depot sits
   * says nothing about where it delivers, and Tiv Taam's Ashdod and Caesarea
   * picking points sit outside the configured boxes while serving addresses
   * inside them. Filtering them out did not hide them, because the delivery
   * surface selects on published coverage; it only stopped their prices being
   * refreshed, so both were quoted as live options on data 15 days old.
   */
  isDeliveryStorefront?: boolean;
}

/**
 * Ingest prices ONLY for storefronts a shopper can order from.
 *
 * The product sells delivery. Measured on production 2026-08-06, 97.7% of every
 * price row we held (7,275,513 of 7,445,734) belonged to a physical branch that
 * no tool on the live surface can route an order to, and downloading them was
 * what pushed the nightly job past the database's capacity: all three ingest
 * jobs failed that night, two on dropped connections under statement-timeout
 * pressure and one out of memory.
 *
 * Off (`SUPER_MCP_ONLINE_STORES_ONLY=0`) restores the branch sweep, which is
 * still what the unmounted physical surface and the shelf-vs-delivery premium
 * comparison would need.
 */
export function onlineStoresOnly(): boolean {
  return process.env.SUPER_MCP_ONLINE_STORES_ONLY !== "0";
}

/**
 * True when this store is somewhere an order can actually be placed.
 *
 * `pickup` counts: click-and-collect is a fulfilment endpoint the delivery
 * surface quotes (`slot_type=pickup`), so its prices have to be as fresh as a
 * delivery depot's. `warehouse` does not, and neither does `branch`.
 */
export function isOrderableStorefront(store: StoreLocationHint): boolean {
  if (store.isDeliveryStorefront) return true;
  const kind = store.storeKind ?? classifyStoreKind(store.name, store.address, store.storeType);
  return kind === "online" || kind === "pickup";
}

/**
 * Every field the two discovery filters need, from a parsed Stores record.
 *
 * One mapper rather than one per adapter: all four fed the region filter the
 * same five fields, and the online filter needs two more. Four copies of that
 * is four chances for a chain to be silently excluded because its adapter was
 * the one that did not get the new field.
 */
export function toStoreLocationHints(records: RawStoreRecord[]): StoreLocationHint[] {
  return records.map((s) => ({
    storeId: s.storeId,
    city: s.city,
    lat: s.geo?.lat,
    lng: s.geo?.lng,
    name: s.name,
    address: s.address,
    storeType: s.storeType,
  }));
}

/** The same hints from store rows we already hold, for a chain whose feed broke. */
export function toStoreLocationHintsFromDb(
  rows: Array<{
    storeId: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
    name: string | null;
    address: string | null;
    storeType: number | null;
    storeKind: string | null;
  }>,
): StoreLocationHint[] {
  return rows.map((s) => ({
    storeId: s.storeId,
    city: s.city ?? undefined,
    lat: s.lat ?? undefined,
    lng: s.lng ?? undefined,
    name: s.name ?? undefined,
    address: s.address ?? undefined,
    storeType: s.storeType ?? undefined,
    storeKind: s.storeKind,
  }));
}

/** Bounding boxes [minLat, maxLat, minLng, maxLng] as fallback when city is missing. */
const REGION_BOXES: Array<{ name: string; box: [number, number, number, number] }> = [
  // Coastal central: ~Ashdod north edge through Netanya / Sharon (Gush Dan + Sharon)
  { name: "gush_dan_sharon", box: [31.88, 32.38, 34.70, 35.05] },
  // Jerusalem metro
  { name: "jerusalem", box: [31.70, 31.90, 35.10, 35.35] },
  // Haifa metro
  { name: "haifa", box: [32.70, 32.95, 34.90, 35.15] },
  // Beersheva
  { name: "beersheva", box: [31.18, 31.32, 34.72, 34.90] },
];

/** Canonical Hebrew city names (and common spellings) in coverage. */
const COVERED_CITIES = new Set(
  [
    // Tel Aviv / Gush Dan
    "תל אביב",
    "תל-אביב",
    "תל אביב יפו",
    "תל אביב-יפו",
    "תלאביב",
    "רמת גן",
    "גבעתיים",
    "בני ברק",
    "בני-ברק",
    "בת ים",
    "בת-ים",
    "חולון",
    "אור יהודה",
    "אור-יהודה",
    "גני תקווה",
    "גני תקוה",
    "קרית אונו",
    "קריית אונו",
    "יהוד",
    "יהוד מונוסון",
    "סביון",
    "אזור",
    // Petah Tikva / east
    "פתח תקווה",
    "פתח תקוה",
    "פתח-תקווה",
    "ראש העין",
    "ראש-העין",
    "אלעד",
    "שהם",
    "שוהם",
    // South Gush Dan / Rishon corridor
    "ראשון לציון",
    "ראשון-לציון",
    'ראשל"צ',
    "ראשלצ",
    "נס ציונה",
    "נס-ציונה",
    "באר יעקב",
    "באר-יעקב",
    "רחובות",
    // Sharon / Netanya corridor
    "הרצליה",
    "רעננה",
    "כפר סבא",
    "כפר-סבא",
    "הוד השרון",
    "הוד-השרון",
    "רמת השרון",
    "רמת-השרון",
    "נתניה",
    "קדימה",
    "קדימה צורן",
    "אבן יהודה",
    "תל מונד",
    "תל-מונד",
    "פרדס חנה",
    "פרדס חנה כרכור",
    "כפר יונה",
    "צורן",
    // Jerusalem
    "ירושלים",
    "מבשרת ציון",
    "מבשרת-ציון",
    "מעלה אדומים",
    "בית שמש",
    // Haifa
    "חיפה",
    "נשר",
    "טירת כרמל",
    "טירת-כרמל",
    "קריית אתא",
    "קרית אתא",
    "קריית ביאליק",
    "קרית ביאליק",
    "קריית מוצקין",
    "קרית מוצקין",
    "קריית ים",
    "קרית ים",
    // Beersheva
    "באר שבע",
    "באר-שבע",
    "בארשבע",
    "עומר",
    "להבים",
    "מיתר",
    "גבעת שמואל",
    "גבעת-שמואל",
  ].map(normalizeCityKey),
);

/** CBS locality codes — single source of truth in @super-mcp/shared cities. */
const COVERED_LOCALITY_CODES = coveredLocalityCodes();

/**
 * Covered-city tokens that are also common Hebrew words, so they must only ever
 * match as an EXACT city value — never by prefix or inside a store name.
 * "אזור" is the town of Azor but also the word for "zone" (אזור תעשייה).
 */
const AMBIGUOUS_CITY_TOKENS = new Set(["אזור"].map(normalizeCityKey));

export { normalizeCityKey };

export function regionFilterEnabled(): boolean {
  return process.env.SUPER_MCP_REGION_FILTER !== "0";
}

/**
 * True if `a` and `b` are equal, or the shorter is a whole-word prefix of the
 * longer (next char after the shared prefix is a space) — never a bare
 * substring/prefix match, so "יהוד" (Yehud) doesn't match "יהודה" (Yehuda).
 */
function isWholeWordPrefix(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return longer.startsWith(`${shorter} `);
}

function localityCodeAllowed(city: string): boolean {
  const digits = parseLocalityCode(city);
  return digits != null && COVERED_LOCALITY_CODES.has(digits);
}

function cityAllowed(city: string | undefined): boolean {
  if (!city) return false;
  if (localityCodeAllowed(city)) return true;
  const key = normalizeCityKey(city);
  if (COVERED_CITIES.has(key)) return true;
  if (key.length < 3) return false;
  // Prefix match for variants like "תל אביב יפו - מרכז", but only on whole-word
  // boundaries so a short covered town isn't a false-positive prefix of an
  // unrelated place name (e.g. "יהוד" / Yehud vs "יהודה" / Yehuda).
  for (const allowed of COVERED_CITIES) {
    if (AMBIGUOUS_CITY_TOKENS.has(allowed)) continue;
    if (isWholeWordPrefix(key, allowed)) return true;
  }
  return false;
}

function pointInBox(lat: number, lng: number, box: [number, number, number, number]): boolean {
  const [minLat, maxLat, minLng, maxLng] = box;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

function geoAllowed(lat?: number, lng?: number): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return REGION_BOXES.some((r) => pointInBox(lat, lng, r.box));
}

/** Weak hint: store name contains a covered city as a whole word. */
function nameHintsCoveredCity(name: string | undefined): boolean {
  if (!name) return false;
  // Hyphens become spaces so "שופרסל-נתניה" still matches; padding gives boundaries.
  const key = ` ${normalizeCityKey(name).replace(/-/g, " ")} `;
  for (const city of COVERED_CITIES) {
    if (city.length < 3 || AMBIGUOUS_CITY_TOKENS.has(city)) continue;
    if (key.includes(` ${city.replace(/-/g, " ")} `)) return true;
  }
  return false;
}

/**
 * True if this store is inside our ingest coverage regions.
 *
 * `city` is expected to be the RESOLVED locality (see resolveStoreCity) — the
 * feed's own value when present, else the one recovered from the branch name.
 * The locality recovered from the name is also checked independently, because
 * price-file discovery hands us raw Stores-XML hints that have not been through
 * that resolution yet. It is strictly better than the `nameHintsCoveredCity`
 * substring scan (it resolves abbreviations like פ"ת and neighborhood suffixes
 * like "חולון המרכבה"), which is kept only as a last-resort fallback.
 */
export function isStoreInIngestRegion(store: StoreLocationHint): boolean {
  // A depot we quote deliveries from is always worth refreshing, wherever it is.
  if (store.isDeliveryStorefront) return true;
  if (cityAllowed(store.city)) return true;
  if (geoAllowed(store.lat, store.lng)) return true;
  if (!store.city && cityAllowed(localityFromStoreName(store.name) ?? undefined)) return true;
  if (nameHintsCoveredCity(store.name) || nameHintsCoveredCity(store.city)) return true;
  return false;
}

/**
 * Build the set of normalized store codes we are allowed to ingest prices for.
 * Uses city first, then lat/lng boxes, then name hints.
 */
export function allowedStoreCodesFromLocations(
  stores: StoreLocationHint[],
  normalizeCode: (code: string) => string,
): Set<string> {
  const allowed = new Set<string>();
  for (const s of stores) {
    if (!isStoreInIngestRegion(s)) continue;
    const code = normalizeCode(s.storeId);
    if (code && code !== "unknown") allowed.add(code);
  }
  return allowed;
}
