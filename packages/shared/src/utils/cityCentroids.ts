/**
 * Store feeds carry no coordinates, so the `near=lat,lng` geo path was dead
 * (0/898 stores geocoded). This maps a canonical Hebrew city name to a WGS84
 * centroid so `geocodeStores.ts` can backfill store.lat/lng at city granularity
 * as a first tier, with address-level refinement layered on top later.
 *
 * Keys MUST match the output of `canonicalizeCity` (canonical Hebrew names), so
 * both "6400" and "הרצליה" stores resolve to the same centroid. Coordinates were
 * sourced from OpenStreetMap Nominatim (town admin centroids) and cover the top
 * cities by store count; the long tail stays unmapped rather than guessed.
 */
import { canonicalizeCity } from "./cities.js";
import { normalizeStoreCoordinates, type StoreCoordinates } from "./storeCoordinates.js";

/** Canonical Hebrew city name → WGS84 centroid. */
export const CITY_CENTROID: Record<string, StoreCoordinates> = {
  // Core metros
  "תל אביב-יפו": { lat: 32.0853, lng: 34.7818 },
  ירושלים: { lat: 31.7788, lng: 35.2258 },
  חיפה: { lat: 32.8191, lng: 34.9984 },
  "באר שבע": { lat: 31.2457, lng: 34.7925 },
  // Gush Dan
  "בני ברק": { lat: 32.0874, lng: 34.8324 },
  "בת ים": { lat: 32.0155, lng: 34.7505 },
  גבעתיים: { lat: 32.073, lng: 34.8113 },
  חולון: { lat: 32.0193, lng: 34.7804 },
  "רמת גן": { lat: 32.0687, lng: 34.8247 },
  "אור יהודה": { lat: 32.027, lng: 34.863 },
  "קריית אונו": { lat: 32.0592, lng: 34.8594 },
  "גבעת שמואל": { lat: 32.0769, lng: 34.8525 },
  סביון: { lat: 32.0475, lng: 34.8799 },
  // Petah Tikva / east
  "פתח תקווה": { lat: 32.0878, lng: 34.886 },
  "ראש העין": { lat: 32.0953, lng: 34.9533 },
  אלעד: { lat: 32.0501, lng: 34.9522 },
  // Rishon corridor
  "ראשון לציון": { lat: 31.9636, lng: 34.8101 },
  רחובות: { lat: 31.8953, lng: 34.8106 },
  "נס ציונה": { lat: 31.9232, lng: 34.7967 },
  "באר יעקב": { lat: 31.9444, lng: 34.8399 },
  // Sharon / Netanya
  נתניה: { lat: 32.3286, lng: 34.8566 },
  הרצליה: { lat: 32.1656, lng: 34.8469 },
  רעננה: { lat: 32.186, lng: 34.8678 },
  "כפר סבא": { lat: 32.1773, lng: 34.9075 },
  "הוד השרון": { lat: 32.1562, lng: 34.893 },
  "רמת השרון": { lat: 32.1431, lng: 34.8381 },
  "תל מונד": { lat: 32.2536, lng: 34.9185 },
  "כפר יונה": { lat: 32.3145, lng: 34.9321 },
  "אבן יהודה": { lat: 32.2725, lng: 34.8868 },
  קדימה: { lat: 32.2764, lng: 34.9125 },
  "פרדס חנה": { lat: 32.475, lng: 34.9751 },
  חריש: { lat: 32.4596, lng: 35.0511 },
  חדרה: { lat: 32.4407, lng: 34.9401 },
  "אור עקיבא": { lat: 32.509, lng: 34.9196 },
  "זכרון יעקב": { lat: 32.5712, lng: 34.953 },
  // Jerusalem metro
  "בית שמש": { lat: 31.7462, lng: 34.9887 },
  "מבשרת ציון": { lat: 31.8057, lng: 35.1527 },
  "מעלה אדומים": { lat: 31.7706, lng: 35.2987 },
  "ביתר עילית": { lat: 31.7019, lng: 35.1073 },
  // Haifa metro / north coast
  נשר: { lat: 32.7709, lng: 35.0381 },
  "קריית אתא": { lat: 32.8116, lng: 35.1164 },
  "קריית ביאליק": { lat: 32.8367, lng: 35.0893 },
  "קריית ים": { lat: 32.8467, lng: 35.0702 },
  "קריית מוצקין": { lat: 32.8391, lng: 35.0804 },
  נהריה: { lat: 33.0063, lng: 35.0946 },
  עכו: { lat: 32.9282, lng: 35.0756 },
  "טירת כרמל": { lat: 32.7614, lng: 34.9716 },
  "קריית טבעון": { lat: 32.7162, lng: 35.1268 },
  "מגדל העמק": { lat: 32.6766, lng: 35.2413 },
  "יקנעם עילית": { lat: 32.6481, lng: 35.0944 },
  // Galilee / valleys
  כרמיאל: { lat: 32.9159, lng: 35.2934 },
  "קריית שמונה": { lat: 33.2075, lng: 35.5708 },
  טבריה: { lat: 32.7939, lng: 35.5329 },
  צפת: { lat: 32.9646, lng: 35.5025 },
  "בית שאן": { lat: 32.4968, lng: 35.4973 },
  "נוף הגליל": { lat: 32.7023, lng: 35.3183 },
  עפולה: { lat: 32.6076, lng: 35.2891 },
  // Shfela / center
  "מודיעין מכבים רעות": { lat: 31.9086, lng: 35.0069 },
  לוד: { lat: 31.9489, lng: 34.8885 },
  רמלה: { lat: 31.928, lng: 34.8623 },
  יבנה: { lat: 31.8769, lng: 34.7383 },
  יהוד: { lat: 32.033, lng: 34.8899 },
  שוהם: { lat: 31.9968, lng: 34.9464 },
  אריאל: { lat: 32.1054, lng: 35.1875 },
  // South
  אשדוד: { lat: 31.7977, lng: 34.653 },
  אשקלון: { lat: 31.6653, lng: 34.565 },
  אילת: { lat: 29.5569, lng: 34.9498 },
  "קריית גת": { lat: 31.6094, lng: 34.7712 },
  אופקים: { lat: 31.3126, lng: 34.6209 },
  נתיבות: { lat: 31.4214, lng: 34.5884 },
  שדרות: { lat: 31.5265, lng: 34.597 },
  ערד: { lat: 31.2612, lng: 35.2146 },
};

/**
 * Pure resolver: canonicalize `city`, look up its centroid, and pass it through
 * the Israel-bounds guard. Returns null when the city is unknown, unmappable
 * ("0"/null), or the centroid somehow falls outside the supported region.
 */
export function centroidForCity(city: string | null | undefined): StoreCoordinates | null {
  const canonical = canonicalizeCity(city);
  if (!canonical) return null;
  const centroid = CITY_CENTROID[canonical];
  if (!centroid) return null;
  return normalizeStoreCoordinates(centroid.lat, centroid.lng);
}
