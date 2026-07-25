/**
 * Neighborhood / landmark → parent locality.
 *
 * Chains that publish no `<City>` frequently name a branch after a
 * neighborhood, industrial zone, or mall rather than the town ("נווה זמר" for
 * Ra'anana, "תלפיות" for Jerusalem, "חוצות המפרץ" for Haifa). Without this
 * layer those rows stay city-less, which means no centroid, no address
 * geocode, and no city filter match — the branch is invisible to every
 * location-scoped query.
 *
 * This is deliberately a SECOND pass behind exact-locality matching (see
 * `extractCityFromLocation`). A neighborhood must never outrank a real locality
 * named in the same string, otherwise "רחוב הרצל, חיפה" could be pulled to
 * whichever city owns a same-named neighborhood.
 *
 * INCLUSION RULE: only distinctive place names whose parent city is
 * unambiguous. Street names are excluded even when a specific branch sits on
 * one: "אחד העם" is a street in dozens of towns, so a Yohananof branch called
 * just "אחד העם" is left unresolved rather than guessed into Tel Aviv. A wrong
 * parent city produces confidently wrong distances, which is worse than none.
 *
 * Keys are raw Hebrew; callers normalize (this module imports nothing so that
 * `cities.ts` can depend on it without a cycle).
 */
export const NEIGHBORHOOD_TO_CITY: Record<string, string> = {
  // Herzliya
  "נוף ים": "הרצליה",
  "נווה עמל": "הרצליה",
  "נווה אמירים": "הרצליה",
  // Tel Aviv
  "נחלת יצחק": "תל אביב-יפו",
  "יד אליהו": "תל אביב-יפו",
  // Ra'anana
  "נווה זמר": "רעננה",
  רננים: "רעננה",
  // Netanya
  פולג: "נתניה",
  // Ramat Hasharon
  גלילות: "רמת השרון",
  // Petah Tikva
  סגולה: "פתח תקווה",
  // Rishon LeZion
  "רמת אליהו": "ראשון לציון",
  // Holon
  המרכבה: "חולון",
  // Jerusalem
  תלפיות: "ירושלים",
  "גבעת רם": "ירושלים",
  // Haifa — Hadar/Kiryat Haim/Kiryat Eliezer are Haifa quarters; Check Post and
  // Horev Center are Haifa landmarks; Hutzot HaMifratz sits in the Haifa bay.
  הדר: "חיפה",
  "קרית חיים": "חיפה",
  "קריית חיים": "חיפה",
  "קרית אליעזר": "חיפה",
  "קריית אליעזר": "חיפה",
  "צק פוסט": "חיפה",
  חורב: "חיפה",
  "חוצות המפרץ": "חיפה",
  // Ashkelon
  ברנע: "אשקלון",
  // Be'er Sheva
  "קניון הבאר": "באר שבע",
  // Kiryat Ekron — the Bilu junction retail strip. The two feed rows that name
  // it ("בילו", "צומת ביל\"ו") sit on opposite sides of the junction (Kiryat
  // Ekron / Givat Brenner, ~2km apart), which is within city-centroid error.
  בילו: "קריית עקרון",
  "ביל ו": "קריית עקרון",
};
