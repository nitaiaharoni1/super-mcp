import { normalizeEmbedInput, stemHebrewToken, tokenizeNormalized } from "@super-mcp/shared";

/**
 * Derived-product guard.
 *
 * Hebrew names a processed product with a construct-state noun next to the raw
 * ingredient: `דפי אורז` (rice PAPER), `מקלוני אורז` (rice STICKS), `אטריות אורז`
 * (rice NOODLES), `שוקולד חלב` (MILK chocolate), `רסק עגבניות` (tomato PASTE),
 * `פירורי לחם` (bread CRUMBS). Each shares the staple's token while being a
 * different product, so token-satisfaction and class gates both wave them
 * through: the LLM taxonomy files rice paper and rice under the same
 * `pantry_dry/grains_rice`, and `class_l3` is populated for under a fifth of the
 * catalog, so the level that would separate them mostly does not exist.
 *
 * `queryHeadAnchored` catches only one shape — the head sitting at index 1 behind
 * a known non-commodity noun. It misses the reversed order, `אורז אטריות`, which
 * puts the staple first; that is how a plain `אורז` line resolved to rice noodles
 * carried by 2 of 159 nearby stores.
 *
 * Two properties keep this from over-rejecting, both learned from running it
 * across the real catalog:
 *
 *  1. **Stem-based "unrequested"**: asking for the derived product keeps it, since
 *     the marker is then a requested stem — `רסק עגבניות` satisfies "רסק עגבניות".
 *     Stems also mean `גבינה`/`גבינת` are the same word, so morphology never
 *     looks like a derived form.
 *  2. **Construct-position window**: the marker only disqualifies where Hebrew
 *     actually puts it — before the staple head, or immediately after it. Without
 *     this, a trailing brand token collides: `לחם מחמצת מכוסמין מלא ד"ר מרק` is
 *     sourdough bread in 527 stores, and the brand "ד"ר מרק" tripped the `מרק`
 *     (soup) marker. Position keeps `מרק עגבניות` rejected and that bread kept.
 *
 * Token families come from the catalog, not intuition — each is a recurring
 * leading noun over products whose name contains a staple. For `%אורז%`:
 * פריכיות(47) אטריות(40) חטיף(38) תערובת(35) משקה(19) קמח(12) דפי(12) פתיתים(11)
 * מקלוני(11) פצפוצי(7). For `%חלב%`: שוקולד(160) חטיף(131) עוגיות(59) אבקת(52)
 * משקה(46) ריבת(26). For `%עגבניות%`: רוטב(103) מיץ(39) רסק(32) שימורי(32)
 * ממרח(20) מחית(19) מרק(10). For `%לחם%`: פירורי(98).
 */

/**
 * Nouns that turn a staple token into a different product.
 *
 * Deliberately EXCLUDED after catalog testing:
 *  - `נתחי` / `פילה` / `סטייק` over `%טונה%` — chunks / fillet / steak ARE canned
 *    tuna, which is what the shopper means.
 *  - `מארז` / `רביעיית` / `שלישיית` — multipack wrappers of the same good; pack
 *    logic owns those.
 *  - `שמנת` (cream) — `foldFinalLetters` maps `שמן`→`שמנ` and `stemHebrewToken`
 *    maps `שמנת`→`שמנ`, so cream and OIL are indistinguishable after stemming.
 *    Including it rejected every `טונה … בשמן` (744 stores) and
 *    `חמאה … חצי שמנת` (500 stores).
 *  - `לבן` (leben) — collides with `לבן`/`לבנה` = "white", the single most common
 *    colour word in the catalog. It rejected `גבינה לבנה תנובה 5%` (772 stores)
 *    and `נייר טואלט … לבן קלינקס` (621 stores).
 *  - `גבינת` / `גבינה` — `גבינת קוטג'` (755 stores) IS cottage cheese and
 *    `גבינה לבנה` IS a staple. Cheese-for-milk is already handled by
 *    `rejectUnsafePlainMilkName`.
 *  - Grinding / drying / roasting, for the same reason `PRESERVED_FORM_TOKENS`
 *    omits them: legitimate forms of staples like coffee.
 */
const DERIVED_FORM_TOKENS: readonly string[] = [
  // Sweets / snacks built ON the staple
  "חטיף", "חטיפי", "חטיפים",
  "שוקולד", "שוקולדים",
  "עוגיות", "עוגייה", "עוגיה",
  "סוכריות", "סוכריה",
  "פופקורן",
  "חלבה",
  "פריכיות", "פרכיות", "פריכית",
  "פצפוצי", "פצפוצים",
  "בצקניות", "בצקנית",
  "וופל", "וופלים",
  // Doughs / pastas / wrappers
  "אטריות", "איטריות", "אטריה",
  "נודלס",
  "פסטה",
  "מקלוני", "מקלונים", "מקלון",
  "דפי", "דף",
  "פירורי", "פרורי", "פירורים",
  "בצק",
  // Liquids / concentrates derived from the staple
  "משקה", "משקאות",
  "שייק",
  "רוטב", "רטבים",
  "רסק",
  "מחית",
  "ריבת", "ריבה",
  "ממרח", "ממרחים",
  "מרק", "מרקים",
  "תרכיז",
  // Powders / mixes / prepared meals
  "אבקת", "אבקה",
  "תערובת",
  "מלית",
  "ארוחת", "ארוחה",
  "מנת",
  "תבשיל",
  "סלט", "סלטים",
  "שימורי", "שימורים",
  // Dairy transformation that is never the milk itself
  "יוגורט",
  // Non-food hosts that merely mention the staple
  "מדבקות", "מדבקה",
  "ערכת", "ערכה",
] as const;

const DERIVED_FORM_STEMS: ReadonlySet<string> = new Set(
  DERIVED_FORM_TOKENS.map((t) => stemHebrewToken(normalizeEmbedInput(t))),
);

/**
 * "Tastes like X" markers. These disqualify ONLY when they sit before the staple
 * head, because that is the position that makes the staple the FLAVOUR rather
 * than the product: `מרגרינה בטעם חמאה` is margarine (696 stores) and
 * `הוטפופ טעם חמאה` is popcorn (778 stores) — both outranked real butter on
 * availability for a bare `חמאה` line.
 *
 * After the head the same word is harmless and must be kept: `יוגורט בטעם תות`
 * is still yogurt for a `יוגורט` line, and `קוטג' בטעם …` is still cottage.
 */
const FLAVOUR_MARKER_STEMS: ReadonlySet<string> = new Set(
  ["טעם", "בטעם", "טעמים", "בטעמים"].map((t) => stemHebrewToken(normalizeEmbedInput(t))),
);

/** Stems of what the shopper typed. */
function queryStems(queryText: string): { head: string | null; all: Set<string> } {
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText)).map(stemHebrewToken);
  return { head: tokens[0] ?? null, all: new Set(tokens) };
}

/**
 * True when the candidate's name carries a derived-form noun the query did not
 * ask for, in the construct position — i.e. it is a product MADE FROM the staple
 * rather than the staple.
 */
export function hasUnrequestedDerivedForm(queryText: string, candidateName: string): boolean {
  if (!queryText.trim() || !candidateName.trim()) return false;
  const { head, all: requested } = queryStems(queryText);
  if (!head) return false;

  const nameStems = tokenizeNormalized(normalizeEmbedInput(candidateName)).map(stemHebrewToken);
  if (nameStems.length === 0) return false;
  const headIndex = nameStems.indexOf(head);

  for (const [index, stem] of nameStems.entries()) {
    const isDerived = DERIVED_FORM_STEMS.has(stem);
    const isFlavour = FLAVOUR_MARKER_STEMS.has(stem);
    if (!isDerived && !isFlavour) continue;
    if (requested.has(stem)) continue;
    // Head absent from the name: it matched on other tokens, so any position of a
    // derived marker is evidence enough. A flavour marker needs the head to judge
    // position, so it cannot conclude anything here.
    if (headIndex === -1) {
      if (isDerived) return true;
      continue;
    }
    // A flavour marker only means "the staple is the flavour" when it leads.
    if (isFlavour) {
      if (index < headIndex) return true;
      continue;
    }
    // Construct position only: modifier before the head, or fused right after it.
    if (index < headIndex || index === headIndex + 1) return true;
  }
  return false;
}

/**
 * Stable partition: true staples first, derived products last, order preserved
 * within each group. Used where emptying the pool would be worse than ranking a
 * derived form last, so an opaque query still resolves to something.
 */
export function preferDirectForm<T extends { name: string }>(
  queryText: string,
  items: T[],
): T[] {
  if (!queryText.trim() || items.length <= 1) return items;
  const direct: T[] = [];
  const derived: T[] = [];
  for (const item of items) {
    (hasUnrequestedDerivedForm(queryText, item.name) ? derived : direct).push(item);
  }
  return direct.length > 0 ? [...direct, ...derived] : items;
}
