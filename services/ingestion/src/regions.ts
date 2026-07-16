/**
 * Ingest coverage: Greater Tel Aviv / coastal central (Rishon–Netanya),
 * plus Jerusalem, Haifa, and Beersheva metros.
 *
 * Store selection for PriceFull/PromoFull is limited to these areas.
 * Disable with SUPER_MCP_REGION_FILTER=0 for debugging.
 */

export interface StoreLocationHint {
  storeId: string;
  city?: string;
  lat?: number;
  lng?: number;
  /** Optional free-text (store name) used as a weak city hint. */
  name?: string;
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
  ].map(normalizeCityKey),
);

/**
 * Covered-city tokens that are also common Hebrew words, so they must only ever
 * match as an EXACT city value — never by prefix or inside a store name.
 * "אזור" is the town of Azor but also the word for "zone" (אזור תעשייה).
 */
const AMBIGUOUS_CITY_TOKENS = new Set(["אזור"].map(normalizeCityKey));

export function regionFilterEnabled(): boolean {
  return process.env.SUPER_MCP_REGION_FILTER !== "0";
}

export function normalizeCityKey(city: string): string {
  return city
    .replace(/\u0000/g, "")
    .trim()
    .replace(/['"״׳`]/g, "")
    .replace(/[–—-]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function cityAllowed(city: string | undefined): boolean {
  if (!city) return false;
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

/** True if this store is inside our ingest coverage regions. */
export function isStoreInIngestRegion(store: StoreLocationHint): boolean {
  if (cityAllowed(store.city)) return true;
  if (geoAllowed(store.lat, store.lng)) return true;
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
