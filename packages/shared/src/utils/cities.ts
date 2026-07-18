/**
 * Israeli store feeds often put CBS locality codes in `<City>` (e.g. "6400")
 * instead of Hebrew names. Agents and users pass natural language ("הרצליה",
 * "Herzliya"). This module canonicalizes on write and expands query aliases on
 * read so one city filter matches both forms without an extra round-trip.
 */
import { scrubNullChars } from "./text.js";

/** CBS locality code → canonical Hebrew display name. */
export const LOCALITY_CODE_TO_CITY: Record<string, string> = {
  // Core metros
  "5000": "תל אביב-יפו",
  "3000": "ירושלים",
  "4000": "חיפה",
  "9000": "באר שבע",
  // Gush Dan
  "6100": "בני ברק",
  "6200": "בת ים",
  "6300": "גבעתיים",
  "6600": "חולון",
  "8600": "רמת גן",
  "2400": "אור יהודה",
  "2620": "קריית אונו",
  "681": "גבעת שמואל",
  "229": "סביון",
  // Petah Tikva / east
  "7900": "פתח תקווה",
  "2640": "ראש העין",
  "1309": "אלעד",
  // Rishon corridor
  "8300": "ראשון לציון",
  "8400": "רחובות",
  // Sharon / Netanya
  "7400": "נתניה",
  "6400": "הרצליה",
  "8700": "רעננה",
  "6900": "כפר סבא",
  "9700": "הוד השרון",
  "2650": "רמת השרון",
  "154": "תל מונד",
  "168": "כפר יונה",
  "182": "אבן יהודה",
  "195": "קדימה",
  "7800": "פרדס חנה",
  // Jerusalem metro
  "2610": "בית שמש",
  "1015": "מבשרת ציון",
  "3616": "מעלה אדומים",
  // Haifa metro
  "2500": "נשר",
  "6800": "קריית אתא",
  "9500": "קריית ביאליק",
  "9600": "קריית ים",
  "8200": "קריית מוצקין",
  "9100": "נהריה",
  "7600": "עכו",
  "2100": "טירת כרמל",
  "2300": "קריית טבעון",
  "874": "מגדל העמק",
  "240": "יקנעם עילית",
  // South
  "70": "אשדוד",
  "7100": "אשקלון",
  "2600": "אילת",
  "8500": "רמלה",
  "7000": "לוד",
  "2630": "קריית גת",
  "31": "אופקים",
  "246": "נתיבות",
  "1031": "שדרות",
  "2560": "ערד",
  // North / Galilee
  "6500": "חדרה",
  "1020": "אור עקיבא",
  "9300": "זכרון יעקב",
  "1247": "חריש",
  "7700": "עפולה",
  "1139": "כרמיאל",
  "2800": "קריית שמונה",
  "6700": "טבריה",
  "8000": "צפת",
  "9200": "בית שאן",
  "1061": "נוף הגליל",
  // Center / Shfela
  "1200": "מודיעין מכבים רעות",
  "2660": "יבנה",
  "9400": "יהוד",
  "2530": "באר יעקב",
  "3570": "אריאל",
  "7200": "נס ציונה",
  "1304": "שוהם",
  "3780": "ביתר עילית",
};

/** Extra aliases (normalized key) → canonical Hebrew. Codes are handled separately. */
const CITY_ALIASES: Record<string, string> = {
  // Tel Aviv
  "תל אביב": "תל אביב-יפו",
  "תל-אביב": "תל אביב-יפו",
  "תל אביב יפו": "תל אביב-יפו",
  "תלאביב": "תל אביב-יפו",
  "tel aviv": "תל אביב-יפו",
  "tel-aviv": "תל אביב-יפו",
  "tel aviv yafo": "תל אביב-יפו",
  // Jerusalem / Haifa / Beersheva
  jerusalem: "ירושלים",
  haifa: "חיפה",
  "beersheva": "באר שבע",
  "beer sheva": "באר שבע",
  "בארשבע": "באר שבע",
  "באר-שבע": "באר שבע",
  // Sharon
  herzliya: "הרצליה",
  herzeliya: "הרצליה",
  "raanana": "רעננה",
  "ra'anana": "רעננה",
  "kfar saba": "כפר סבא",
  "kfar-saba": "כפר סבא",
  "כפר-סבא": "כפר סבא",
  "hod hasharon": "הוד השרון",
  "הוד-השרון": "הוד השרון",
  "ramat hasharon": "רמת השרון",
  "רמת-השרון": "רמת השרון",
  netanya: "נתניה",
  // Gush Dan
  "ramat gan": "רמת גן",
  "givatayim": "גבעתיים",
  "bnei brak": "בני ברק",
  "בני-ברק": "בני ברק",
  "bat yam": "בת ים",
  "בת-ים": "בת ים",
  holon: "חולון",
  "or yehuda": "אור יהודה",
  "אור-יהודה": "אור יהודה",
  "kiryat ono": "קריית אונו",
  "קרית אונו": "קריית אונו",
  "givat shmuel": "גבעת שמואל",
  "גבעת-שמואל": "גבעת שמואל",
  // Petah Tikva / Rishon
  "petah tikva": "פתח תקווה",
  "petah tikvah": "פתח תקווה",
  "פתח תקוה": "פתח תקווה",
  "פתח-תקווה": "פתח תקווה",
  "rosh haayin": "ראש העין",
  "ראש-העין": "ראש העין",
  "rishon lezion": "ראשון לציון",
  "rishon leziyon": "ראשון לציון",
  "ראשון-לציון": "ראשון לציון",
  'ראשל"צ': "ראשון לציון",
  ראשלצ: "ראשון לציון",
  rehovot: "רחובות",
  // Misc covered
  "beit shemesh": "בית שמש",
  "mevaseret zion": "מבשרת ציון",
  "מבשרת-ציון": "מבשרת ציון",
};

/** CBS locality code digits when `city` is numeric; otherwise null. */
export function parseLocalityCode(city: string): string | null {
  const digits = scrubNullChars(city).trim().replace(/^0+/, "") || "0";
  return /^\d+$/.test(digits) ? digits : null;
}

export function normalizeCityKey(city: string): string {
  return scrubNullChars(city)
    .trim()
    .replace(/['"״׳`]/g, "")
    .replace(/[–—-]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Canonical Hebrew city name when known; otherwise the scrubbed original. */
export function canonicalizeCity(city: string | null | undefined): string | undefined {
  if (city == null) return undefined;
  const scrubbed = scrubNullChars(city).trim();
  if (!scrubbed) return undefined;

  const digits = parseLocalityCode(scrubbed);
  if (digits && LOCALITY_CODE_TO_CITY[digits]) {
    return LOCALITY_CODE_TO_CITY[digits];
  }

  const key = normalizeCityKey(scrubbed);
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  // Already canonical Hebrew (exact) — keep as-is if it is a known target.
  for (const he of Object.values(LOCALITY_CODE_TO_CITY)) {
    if (normalizeCityKey(he) === key) return he;
  }
  return scrubbed;
}

/** Display name for API responses (codes → Hebrew when possible). */
export function displayCity(city: string | null | undefined): string | null {
  return canonicalizeCity(city) ?? null;
}

/**
 * All stored-city values that should match a natural-language (or code) query.
 * Use with `st.city = ANY($n::text[])` so "הרצליה", "Herzliya", and "6400" hit
 * the same stores without a second lookup.
 */
export function cityMatchKeys(cityQuery: string): string[] {
  const scrubbed = scrubNullChars(cityQuery).trim();
  if (!scrubbed) return [];

  const canonical = canonicalizeCity(scrubbed) ?? scrubbed;
  const keys = new Set<string>();
  keys.add(scrubbed);
  keys.add(canonical);

  const digits = parseLocalityCode(scrubbed);
  if (digits) keys.add(digits);

  for (const [code, he] of Object.entries(LOCALITY_CODE_TO_CITY)) {
    if (he === canonical) {
      keys.add(code);
      keys.add(he);
    }
  }

  const canonKey = normalizeCityKey(canonical);
  for (const [alias, he] of Object.entries(CITY_ALIASES)) {
    if (he === canonical || normalizeCityKey(he) === canonKey) {
      keys.add(alias);
      // Also keep a spaced/title-ish form for Hebrew aliases already spaced.
      if (/[\u0590-\u05FF]/.test(alias)) keys.add(alias);
    }
  }

  // Common Hebrew spelling variants that may already exist in DB rows.
  if (canonical === "פתח תקווה") keys.add("פתח תקוה");
  if (canonical === "תל אביב-יפו") {
    keys.add("תל אביב");
    keys.add("תל-אביב");
    keys.add("תל אביב יפו");
  }

  return [...keys].filter(Boolean);
}

/** CBS codes we treat as in-coverage (for ingest region filter). */
export function coveredLocalityCodes(): ReadonlySet<string> {
  return new Set(Object.keys(LOCALITY_CODE_TO_CITY));
}
