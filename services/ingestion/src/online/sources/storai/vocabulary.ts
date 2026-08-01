/**
 * The query vocabulary the stor.ai sweep walks.
 *
 * WHY A WORD LIST AND NOT PAGINATION
 *
 * Stor.ai's product endpoint cannot be paged. Measured against a live tenant:
 * `?limit=500` returns 20 rows, `offset` is ignored, and a request without a
 * non-empty `query` is refused with 403. There is no category or family route
 * either (`/categories`, `/families`, `?categoryId=`, `?familyId=` all 400/403).
 * Search is the only door.
 *
 * So coverage is whatever the vocabulary reaches. That is a real limitation and
 * it is stated in the adapter's docs rather than hidden: this source yields a
 * few thousand commonly-shopped products per store, not a complete catalogue.
 *
 * The list is deliberately what a shopper types, not a merchandising taxonomy.
 * A basket asks for "חלב" and "קוטג", so those are worth more than an exhaustive
 * walk of long-tail SKUs nobody puts on a list.
 */
export const STORAI_QUERY_VOCABULARY: readonly string[] = [
  // Dairy and eggs
  "חלב", "קוטג", "גבינה", "גבינת שמנת", "יוגורט", "מעדן", "שמנת", "חמאה", "ביצים",
  "לבן", "אשל", "צהובה", "מוצרלה", "פטה", "בולגרית", "ריקוטה", "שוקו",
  // Bread and bakery
  "לחם", "פיתות", "לחמניות", "חלה", "בגט", "טורטיה", "מצות", "עוגה", "עוגיות",
  "קרואסון", "בורקס", "פיצה",
  // Meat, poultry, fish
  "עוף", "שניצל", "חזה עוף", "כנפיים", "בשר", "בקר", "טחון", "המבורגר", "נקניקיות",
  "סלמי", "פסטרמה", "דג", "סלמון", "טונה", "אמנון", "שקדי עוף",
  // Fruit and veg
  "עגבניות", "מלפפון", "בצל", "תפוח אדמה", "גזר", "פלפל", "חסה", "כרוב", "קישוא",
  "חציל", "בננות", "תפוחים", "תפוזים", "לימון", "אבוקדו", "אבטיח", "מלון", "ענבים",
  "תותים", "שום", "פטרוזיליה", "כוסברה", "שמיר", "בטטה", "פטריות",
  // Pantry
  "אורז", "פסטה", "ספגטי", "קוסקוס", "בורגול", "עדשים", "חומוס", "שעועית", "קמח",
  "סוכר", "מלח", "פלפל שחור", "שמן", "שמן זית", "חומץ", "רוטב עגבניות", "רסק עגבניות",
  "מיונז", "קטשופ", "חרדל", "טחינה", "סילאן", "דבש", "ריבה", "שוקולד למריחה",
  "קורנפלקס", "גרנולה", "קוואקר", "פתיתים", "אבקת מרק", "שקדים", "אגוזים", "צימוקים",
  // Drinks
  "מים", "מים מינרלים", "סודה", "קולה", "ספרייט", "מיץ", "מיץ תפוזים", "בירה", "יין",
  "קפה", "קפה נמס", "תה", "חלב סויה", "שתייה קלה", "אנרגיה",
  // Frozen and prepared
  "קפוא", "גלידה", "אפונה", "תירס", "ירקות קפואים", "מלאווח", "ג'חנון", "פירה",
  // Snacks and sweets
  "במבה", "ביסלי", "תפוצ'יפס", "חטיף", "שוקולד", "סוכריות", "ופל", "עוגיות שוקולד",
  "פופקורן", "בייגלה", "קרקר",
  // Baby
  "טיטולים", "מגבונים", "מטרנה", "סימילק", "מזון תינוקות",
  // Household and personal care
  "נייר טואלט", "מגבות נייר", "אבקת כביסה", "מרכך כביסה", "סבון", "סבון כלים",
  "אקונומיקה", "מנקה", "שקיות אשפה", "שמפו", "מרכך", "משחת שיניים", "מברשת שיניים",
  "דאודורנט", "תחבושות", "נייר אפייה", "אלומיניום", "ניילון נצמד",
];
