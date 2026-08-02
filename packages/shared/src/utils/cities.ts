/**
 * Israeli store feeds often put CBS locality codes in `<City>` (e.g. "6400")
 * instead of Hebrew names. Agents and users pass natural language ("הרצליה",
 * "Herzliya"). This module canonicalizes on write and expands query aliases on
 * read so one city filter matches both forms without an extra round-trip.
 */
import { NEIGHBORHOOD_TO_CITY } from "./neighborhoods.js";
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
  // Long tail: every remaining code that appears in `store.city`. Each was
  // resolved by cross-checking the CBS code against the naming and street
  // address of the very rows that carry it (e.g. 2550 → both stores are named
  // "אקספרס גדרה"), so the mapping is evidence-backed rather than recalled.
  // Adding a code here widens display/geocoding only: the ingest region filter
  // reads the separate explicit IN_REGION_LOCALITY_CODES set below.
  "26": "ראש פינה",
  "28": "מזכרת בתיה",
  "47": "כפר תבור",
  "50": "גבעת עדה",
  "53": "עתלית",
  "96": "יגור",
  "99": "מצפה רמון",
  "104": "מזרע",
  "139": "עין שמר",
  "155": "באר טוביה",
  "166": "גן יבנה",
  "171": "פרדסיה",
  "194": "משמר השרון",
  "276": "צור משה",
  "285": "אלונים",
  "316": "כפר נטר",
  "346": "גליל ים",
  "386": "בני דרור",
  "469": "קריית עקרון",
  "494": "דלית אל כרמל",
  "502": "ירכא",
  "587": "סביון",
  "654": "כפר קרע",
  "666": "עומר",
  "831": "ירוחם",
  "877": "בית חירות",
  "922": "רכסים",
  // Kastina junction: the code is not a CBS locality we can pin, but both rows
  // give "א.ת באר טוביה" as the address, so the regional council seat is used.
  "1034": "באר טוביה",
  "1050": "בית חשמונאי",
  "1063": "מעלות תרשיחא",
  "1161": "רהט",
  "1165": "שילת",
  "1167": "קיסריה",
  "1263": "כפר ורדים",
  "1268": "מיתר",
  "1271": "להבים",
  "1306": "צור יגאל",
  "1315": "מתן",
  "1319": "בת חפר",
  "1345": "צור יצחק",
  "2006": "כנות",
  "2034": "חצור הגלילית",
  "2200": "דימונה",
  "2550": "גדרה",
  "2720": "טירה",
  "2730": "טייבה",
  "3797": "מודיעין עילית",
  "4100": "קצרין",
  "7500": "סחנין",
  "8800": "שפרעם",
  "8900": "טמרה",
  "9800": "בנימינה",
  // Chain-internal codes above 10000 are not CBS localities; these three are
  // resolved purely from the branch name/address they appear on.
  "10018": "עמק חפר",
  "10044": "אפרת",
  "10098": "דלית אל כרמל",
};

/**
 * Canonical localities that no feed emits as a CBS code, but that DO appear in
 * branch names we recover cities from ("אשדות יעקב", "צומת מגדל", "גוש עציון").
 * Kept out of LOCALITY_CODE_TO_CITY so `cityMatchKeys` never emits a synthetic
 * code into a SQL `city = ANY(...)` filter; enumerated alongside it everywhere
 * a canonical-name list is needed.
 */
const EXTRA_CANONICAL_CITIES: readonly string[] = [
  "אשדות יעקב",
  "מבקיעים",
  "מגדל",
  "נצרת",
  "עין המפרץ",
  "גוש עציון",
  "שער בנימין",
  "איירפורט סיטי",
];

/**
 * Every canonical Hebrew locality name this module knows. Exported so the
 * gazetteer/centroid tables can be asserted in step: a locality with no
 * centroid still yields no coordinates, which is the bug this expansion fixes.
 */
export function allCanonicalCities(): string[] {
  return [...Object.values(LOCALITY_CODE_TO_CITY), ...EXTRA_CANONICAL_CITIES];
}

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
  // Feeds write "קרית" (one yud) as often as the canonical "קריית".
  "קרית שמונה": "קריית שמונה",
  "קרית עקרון": "קריית עקרון",
  עקרון: "קריית עקרון",
  "קרית אתא": "קריית אתא",
  "קרית ביאליק": "קריית ביאליק",
  "קרית ים": "קריית ים",
  "קרית מוצקין": "קריית מוצקין",
  "קרית גת": "קריית גת",
  "קרית טבעון": "קריית טבעון",
  // Spelling / short forms seen in store names and addresses.
  מעלות: "מעלות תרשיחא",
  "מעלות-תרשיחא": "מעלות תרשיחא",
  תרשיחא: "מעלות תרשיחא",
  "דליית אל כרמל": "דלית אל כרמל",
  "דלית אל-כרמל": "דלית אל כרמל",
  "דאלית אל כרמל": "דלית אל כרמל",
  "מודיעין עלית": "מודיעין עילית",
  // Bare "מודיעין" means Modiin-Maccabim-Reut; the Illit spellings above are
  // longer, so longest-first phrase matching keeps them distinct.
  מודיעין: "מודיעין מכבים רעות",
  "מודיעין מכבים": "מודיעין מכבים רעות",
  סכנין: "סחנין",
  יוקנעם: "יקנעם עילית",
  יקנעם: "יקנעם עילית",
  "יוקנעם עילית": "יקנעם עילית",
  "יקנעם עלית": "יקנעם עילית",
  "ראש-פינה": "ראש פינה",
  "גן-יבנה": "גן יבנה",
  "בנימינה-גבעת עדה": "בנימינה",
  // Mishor Adumim is the industrial zone abutting Ma'ale Adumim (~2km), which is
  // inside city-centroid error, so it resolves to the town rather than a new point.
  "מישור אדומים": "מעלה אדומים",
  // Nazareth Illit was renamed Nof HaGalil; keep both pointing at the current name
  // and make sure the two-word form outranks the bare "נצרת" locality.
  "נצרת עילית": "נוף הגליל",
  "נצרת עלית": "נוף הגליל",
  איירפורט: "איירפורט סיטי",
};

/**
 * CBS locality code digits when `city` is numeric; otherwise null. A bare "0"
 * (feeds emit it as a null-city placeholder) is not a real locality — return
 * null so it is dropped rather than stored as the literal city "0".
 */
export function parseLocalityCode(city: string): string | null {
  const digits = scrubNullChars(city).trim().replace(/^0+/, "");
  if (!digits) return null;
  return /^\d+$/.test(digits) ? digits : null;
}

export function normalizeCityKey(city: string): string {
  return (
    scrubNullChars(city)
      .trim()
      .replace(/['"״׳`]/g, "")
      .replace(/[–—-]/g, "-")
      .replace(/\s+/g, " ")
      // Spacing around a hyphen is typography, not identity. Rami Levy's delivery
      // page writes "תל אביב - יפו" and the canonical name is "תל אביב-יפו";
      // without this the two are different places and the chain reported that it
      // does not deliver to Tel Aviv. No Israeli locality uses " - " as a real
      // separator, so collapsing it cannot merge two distinct places.
      .replace(/\s*-\s*/g, "-")
      .toLowerCase()
  );
}

/** Canonical Hebrew city name when known; otherwise the scrubbed original. */
export function canonicalizeCity(city: string | null | undefined): string | undefined {
  if (city == null) return undefined;
  const scrubbed = scrubNullChars(city).trim();
  if (!scrubbed) return undefined;
  // Feeds emit a bare "0" (or "000") as a null-city placeholder; treat as absent
  // so it is neither stored as the literal city "0" nor proposed as an alias.
  if (/^0+$/.test(scrubbed)) return undefined;

  const digits = parseLocalityCode(scrubbed);
  if (digits && LOCALITY_CODE_TO_CITY[digits]) {
    return LOCALITY_CODE_TO_CITY[digits];
  }

  const key = normalizeCityKey(scrubbed);
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  // Already canonical Hebrew (exact) — keep as-is if it is a known target.
  for (const he of allCanonicalCities()) {
    if (normalizeCityKey(he) === key) return he;
  }
  return scrubbed;
}

/** Display name for API responses (codes → Hebrew when possible). */
export function displayCity(city: string | null | undefined): string | null {
  return canonicalizeCity(city) ?? null;
}

type LocationCityCandidate = { alias: string; canonical: string };

/**
 * Longest-first alias/canonical phrases for embedded-city extraction from
 * free-text addresses. Built once from LOCALITY_CODE_TO_CITY + CITY_ALIASES.
 */
function buildPhraseCandidates(
  entries: Iterable<readonly [string, string]>,
): readonly LocationCityCandidate[] {
  const seen = new Set<string>();
  const out: LocationCityCandidate[] = [];
  for (const [alias, canonical] of entries) {
    const normalizedAlias = normalizeCityKey(alias);
    if (!normalizedAlias || seen.has(normalizedAlias)) continue;
    seen.add(normalizedAlias);
    out.push({ alias: normalizedAlias, canonical });
  }
  out.sort(
    (a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias, "he"),
  );
  return out;
}

const LOCATION_CITY_CANDIDATES: readonly LocationCityCandidate[] = buildPhraseCandidates([
  ...allCanonicalCities().map((he) => [he, he] as const),
  ...Object.entries(CITY_ALIASES).map(([alias, canonical]) => [alias, canonical] as const),
]);

/**
 * Neighborhood phrases, indexed exactly like localities but searched only after
 * every locality pass has missed (see `extractCityFromLocation`).
 */
const NEIGHBORHOOD_CANDIDATES: readonly LocationCityCandidate[] = buildPhraseCandidates(
  Object.entries(NEIGHBORHOOD_TO_CITY).map(
    ([neighborhood, city]) => [neighborhood, city] as const,
  ),
);

/** True when `phrase` appears in `haystack` as a whole-token sequence. */
function containsCityPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u");
  return re.test(haystack);
}

/**
 * Words that introduce a street, so the name after them is a street and not the
 * town of the same name. Israeli streets are routinely named after other
 * places: "שדרות ירושלים, בת ים" is in Bat Yam, not Jerusalem.
 */
const STREET_PREFIXES = [
  "רחוב",
  "רח",
  "שדרות",
  "שדרת",
  "שדרה",
  "שד",
  "דרך",
  "סמטת",
  "סמטה",
  "מעלה",
  "כיכר",
  "ככר",
];

/**
 * True when this match is a street name rather than the locality.
 *
 * Two shapes, and the second is the one that actually bit. "שדרות ירושלים 5,
 * בת ים" is the ordinary case: the locality name follows a street word. But
 * "שדרות" is ALSO a town, and it is the longest alias in play, so
 * "שדרות התמרים 1, אילת" matched Sderot and priced an Eilat basket against a
 * town 200km away — every boulevard address in the country resolved to Sderot.
 * A street word followed by another word is the street; standing alone, or last
 * before a comma, it is the town.
 */
function isStreetNameMatch(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixes = STREET_PREFIXES.join("|");
  const afterStreetWord = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${prefixes})\\.?\\s+${escaped}(?:$|[^\\p{L}\\p{N}])`,
    "u",
  );
  if (afterStreetWord.test(haystack)) {
    // Only a street name if every occurrence is one; "שדרות ירושלים, ירושלים"
    // still names the city.
    const standalone = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(?<!(?:${prefixes})\\.?\\s)${escaped}(?:$|[^\\p{L}\\p{N}])`,
      "u",
    );
    if (!standalone.test(haystack)) return true;
  }
  if (!STREET_PREFIXES.includes(phrase)) return false;
  // The alias is itself a street word. It names the town only where it is not
  // followed by the rest of a street name.
  const asStreetWord = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}\\s+\\p{L}`,
    "u",
  );
  const asTown = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}\\s])`, "u");
  return asStreetWord.test(haystack) && !asTown.test(haystack);
}

/**
 * Parent locality for a neighborhood / landmark phrase, or null when the text
 * carries none. Longest whole-token match, same matcher the locality pass uses.
 */
export function cityForNeighborhood(text: string): string | null {
  const normalized = normalizeCityKey(text);
  if (!normalized) return null;
  for (const candidate of NEIGHBORHOOD_CANDIDATES) {
    if (containsCityPhrase(normalized, candidate.alias)) return candidate.canonical;
  }
  return null;
}

/**
 * Extract a known Israeli city from free-text location (address/neighborhood).
 * Uses longest word-boundary match over canonical names and aliases.
 * Returns null when no known city is embedded.
 *
 * Two passes, localities first: a neighborhood must never outrank a real
 * locality named in the same string. "רחוב הרצל, חיפה" has to resolve to חיפה
 * even though a longer neighborhood phrase elsewhere in the table might also
 * match, so the neighborhood table is consulted only when no locality hit at
 * all. That also lets a bare "נווה עמל" resolve to הרצליה, which is what makes
 * city-less branch names geocodable.
 */
export function extractCityFromLocation(location: string): string | null {
  const normalized = normalizeCityKey(location);
  if (!normalized) return null;
  for (const candidate of LOCATION_CITY_CANDIDATES) {
    if (!containsCityPhrase(normalized, candidate.alias)) continue;
    // A street named after a place is not that place.
    if (isStreetNameMatch(normalized, candidate.alias)) continue;
    return candidate.canonical;
  }
  return cityForNeighborhood(normalized);
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

/**
 * CBS locality codes inside the ingest coverage region (central Israel + the
 * metro corridors we ingest when SUPER_MCP_REGION_FILTER=1). This is kept as an
 * EXPLICIT set, decoupled from LOCALITY_CODE_TO_CITY: that map is a complete
 * code→name lookup used for display and geocoding (nationwide, incl. Eilat,
 * Ashkelon, etc.), so deriving coverage from its keys would silently pull
 * out-of-region cities into the ingest filter. Add a code here only when the
 * locality is genuinely in the ingest region.
 */
const IN_REGION_LOCALITY_CODES: ReadonlySet<string> = new Set([
  "154", "168", "182", "195", "229", "681", "1015", "1309", "2400", "2500",
  "2610", "2620", "2640", "2650", "3000", "3616", "4000", "5000", "6100", "6200",
  "6300", "6400", "6600", "6800", "6900", "7400", "7800", "7900", "8300", "8400",
  "8600", "8700", "9000", "9500", "9600", "9700",
]);

/** CBS codes we treat as in-coverage (for ingest region filter). */
export function coveredLocalityCodes(): ReadonlySet<string> {
  return IN_REGION_LOCALITY_CODES;
}
