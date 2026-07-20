import {
  compareClassPaths,
  normalizeEmbedInput,
  packSizesCompatible,
  queryTokensSatisfied,
  stemHebrewToken,
  tokenizeNormalized,
} from "@super-mcp/shared";
import { allowsCountToWeight } from "./countWeightPolicy.js";
import { resolveCoverageClassScope, scopedClassesConflict } from "./coverageScope.js";
import type { BasketCandidate } from "./types.js";

export { queryTokensSatisfied } from "@super-mcp/shared";

/** Build the LLM taxonomy path from a candidate's class levels. */
function classPathOf(c: BasketCandidate) {
  return { l1: c.classL1 ?? null, l2: c.classL2 ?? null, l3: c.classL3 ?? null };
}

/**
 * The LLM taxonomy places these two in DIFFERENT classes (compared at the deepest
 * level both carry) — never interchangeable. "unknown" (either unclassified) is
 * not a disagreement, so pre-classification behavior is preserved.
 * When queryText is provided, bare wine-family queries treat L3 color leaves as
 * interchangeable under the wine L2 family.
 */
function classesConflict(
  a: BasketCandidate,
  b: BasketCandidate,
  queryText = "",
): boolean {
  if (queryText.trim()) {
    const scope = resolveCoverageClassScope(queryText, a);
    if (scope) return scopedClassesConflict(a, b, scope);
  }
  return compareClassPaths(classPathOf(a), classPathOf(b)) === "different";
}

/**
 * The two carry DIFFERENT labeled variants (regular vs diet_zero, regular vs
 * cherry_grape, regular vs organic) — not substitutes. The primary's variant
 * reflects the query (a generic line ranks a `regular` SKU on top; "עגבניות שרי"
 * ranks a `cherry_grape` one), so "same variant as the primary" both keeps a
 * generic line on regular and honors an explicit variety. Unknown on either side
 * is not a conflict. Replaces the old NEUTRAL_TOKENS / preserved-word variety guards.
 */
export function variantConflict(a: BasketCandidate, b: BasketCandidate): boolean {
  return Boolean(a.variant && b.variant && a.variant !== b.variant);
}

// Utensil / container / device / toy nouns. When one of these LEADS a product
// name, the product IS that thing (a pasta spoon, a water gun, a paper holder, a
// milk frother, a fruit juicer) — not the commodity the query named. Normalized,
// unstemmed forms as they appear after tokenization.
const NON_COMMODITY_LEADERS: ReadonlySet<string> = new Set([
  // utensils / containers / devices / toys
  "כף", "כפית", "מזלג", "סכין", "אקדח", "משחק", "אחסונית", "מסחטת", "מסחטה",
  "מטחנת", "מטחנה", "מועך", "מקציף", "כד", "מסננת", "מכשיר", "מתקן", "סיר",
  "מחבת", "צלחת", "קולפן", "מברשת", "מגירת", "קנקן", "בקבוקון", "קערת", "כוסון",
  "כוס", "פלסט",
  // openers / corkscrews — "יין" must never auto-resolve to "חולץ יין" / "פותחן יין"
  "חולץ", "פותחן", "מחלץ",
  // "derived product OF X" (vinegar/juice/powder/concentrate of X ≠ X)
  "חומץ", "מיץ", "אבקת", "תרכיז",
  // prepared-food / dessert hosts — "לימונים" ≠ "עוגת לימונים"; "קולה" ≠ "לקריץ קולה"
  // Include common plurals; queryHeadAnchored also checks stemmed leaders.
  "עוגת", "עוגה", "עוגות", "מאפה", "מאפי", "מאפים", "לקריץ", "סוכריות", "סוכריה",
  "גלידת", "גלידה", "גלידות", "ליקר",
  // stuffed-dough hosts — the DISH is dumplings/ravioli/burekas, not the filling:
  // "בשר" ≠ "כיסונים בשר בקר"; "גבינה" ≠ "בורקס גבינה". Plurals stemmed automatically.
  "כיסונים", "כיסון", "בורקס", "בורקסים", "רביולי", "טורטליני",
]);

/** Stemmed forms of NON_COMMODITY_LEADERS so plurals (עוגות→עוג) still match. */
const NON_COMMODITY_LEADER_STEMS: ReadonlySet<string> = new Set(
  [...NON_COMMODITY_LEADERS].map((t) => stemHebrewToken(t)),
);

/** Common produce query stems — fallback when both pack units are missing. */
const PRODUCE_QUERY_STEMS: ReadonlySet<string> = new Set(
  [
    "עגבניה",
    "עגבניות",
    "מלפפון",
    "מלפפונים",
    "בצל",
    "בצלים",
    "לימון",
    "לימונים",
    "גזר",
    "תפוח",
    "תפוז",
    "בננה",
    "אבטיח",
    "מלון",
    "פלפל",
    "שום",
    "חציל",
    "קישוא",
    "אבוקדו",
    "בטטה",
  ].map(stemHebrewToken),
);

function queryLooksLikeProduce(queryText: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  return tokens.some((t) => PRODUCE_QUERY_STEMS.has(stemHebrewToken(t)));
}

function allowCountToWeight(
  a: BasketCandidate,
  b: BasketCandidate,
  queryText: string,
): boolean {
  if (
    allowsCountToWeight({
      classL1: a.classL1,
      classL2: a.classL2,
      productClass: a.productClass,
    }) ||
    allowsCountToWeight({
      classL1: b.classL1,
      classL2: b.classL2,
      productClass: b.productClass,
    })
  ) {
    return true;
  }
  const aMissing = a.sizeUnit == null || a.sizeUnit === "";
  const bMissing = b.sizeUnit == null || b.sizeUnit === "";
  if (aMissing && bMissing) return queryLooksLikeProduce(queryText);
  return false;
}

function packsCompatible(
  a: BasketCandidate,
  b: BasketCandidate,
  queryText: string,
  packTolerance: number,
): boolean {
  return packSizesCompatible(
    { sizeQty: a.sizeQty, sizeUnit: a.sizeUnit, name: a.name },
    { sizeQty: b.sizeQty, sizeUnit: b.sizeUnit, name: b.name },
    {
      packTolerance,
      allowCountToWeight: allowCountToWeight(a, b, queryText),
    },
  ).compatible;
}

/**
 * The query's HEAD (first content token) must lead the primary name — appear
 * within its first two tokens (allowing one leading BRAND / cut descriptor).
 * Blocks two failure modes: the query word as a trailing MODIFIER ("חלב" →
 * "בריסטה מקציף חלב", a frother), and a leading utensil/container/device noun
 * ("פסטה" → "כף פסטה", a pasta spoon; "מים" → "אקדח מים", a water gun). Legit
 * brand/cut-led names ("תנובה חלב 3%", "סטייק פרגיות עוף") still pass.
 */
export function queryHeadAnchored(queryText: string, primaryName: string): boolean {
  const q = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (q.length === 0) return true;
  const head = stemHebrewToken(q[0]!);
  const nameRaw = tokenizeNormalized(normalizeEmbedInput(primaryName));
  const first2 = nameRaw.slice(0, 2).map(stemHebrewToken);
  const idx = first2.indexOf(head);
  if (idx === -1) return false;
  // head at position 1 behind a utensil/container/device leader → not the commodity
  if (
    idx === 1 &&
    nameRaw[0] &&
    (NON_COMMODITY_LEADERS.has(nameRaw[0]) ||
      NON_COMMODITY_LEADER_STEMS.has(stemHebrewToken(nameRaw[0])))
  ) {
    return false;
  }
  return true;
}

/**
 * Stable partition: head-anchored hits first, utensil/derived leaders last.
 * When nothing is anchored, the input order is preserved.
 */
export function preferQueryHeadAnchored<T extends { name: string }>(
  queryText: string,
  hits: T[],
): T[] {
  if (!queryText || hits.length <= 1) return hits;
  const anchored: T[] = [];
  const rest: T[] = [];
  for (const hit of hits) {
    (queryHeadAnchored(queryText, hit.name) ? anchored : rest).push(hit);
  }
  return anchored.length > 0 ? [...anchored, ...rest] : hits;
}

// Preserved/prepared forms that are a DIFFERENT product from the fresh staple,
// even though the name shares the query token: pickled/soured/canned, sliced/
// chopped/grated deli cuts, and lime (a different fruit from lemon). Grouping
// "מלפפון" (fresh cucumber) with "מלפפונים בייבי כבושי" (pickled) or "מלפפונים
// פרוסים" (deli-sliced) priced a 33₪ jar/pack as a cucumber; "לימון" pulled in
// "לימון ליים" (lime). These never join a set unless the query asked for that
// form. Kept to unambiguous processing/variety words — drying/roasting/grinding
// are excluded from the list because they're legitimate for staples like coffee
// (קפה נמס מיובש / קפה טחון) and would over-filter.
const PRESERVED_FORM_TOKENS: ReadonlySet<string> = new Set([
  "כבוש",
  "כבושה",
  "כבושי",
  "כבושים",
  "חמוץ",
  "חמוצה",
  "חמוצים",
  "מוחמץ",
  "מוחמצים",
  "משומר",
  "משומרת",
  "משומרים",
  "פרוס",
  "פרוסה",
  "פרוסות",
  "פרוסים",
  "קצוץ",
  "קצוצה",
  "קצוצים",
  "מגורד",
  "מגוררת",
  "מגורר",
  "ממולא",
  "ממולאים",
  "ליים",
]);

/** A candidate whose name carries a preserved-form token the query did not ask for. */
export function hasUnrequestedPreservedForm(queryTokens: Set<string>, candidateName: string): boolean {
  for (const t of tokenizeNormalized(normalizeEmbedInput(candidateName))) {
    if (PRESERVED_FORM_TOKENS.has(t) && !queryTokens.has(t)) return true;
  }
  return false;
}

/**
 * Interchangeable SKUs for an AUTO-RESOLVED commodity line, so per-chain pricing
 * can pick the CHEAPEST across chains (the default when the user didn't name a
 * variety/brand). A candidate joins the set when it is AT LEAST AS SPECIFIC as
 * the query — every query token appears in its name — and shares the primary's
 * class, unit, and size (±tolerance). This respects query specificity in both
 * directions:
 *   • 'יין אדום'        → every red wine ('יין אדום …') qualifies → cheapest wins.
 *   • 'יין אדום קברנה'  → only wines whose name also has 'קברנה' → no off-variety.
 *   • 'עגבניות'         → all 'עגבניות …' produce SKUs (fragmented per chain).
 * An unclassified primary gets no set (never widen without a class signal).
 */
export function buildCommodityEquivalents(
  top: BasketCandidate,
  shortlist: BasketCandidate[],
  queryText: string,
  maxEquivalents: number,
  packTolerance = 0.5,
): BasketCandidate[] {
  if (!top.productClass) return [top];
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return [top];
  const queryTokenSet = new Set(queryTokens);
  const bothLabeled = (c: BasketCandidate) => Boolean(top.classL1 && c.classL1);
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.productClass !== top.productClass) continue;
    if (classesConflict(top, c, queryText)) continue; // different L3 (onion≠scallion); bare יין allows color peers
    if (variantConflict(top, c)) continue; // regular≠cherry/zero/organic
    if (!packsCompatible(top, c, queryText, packTolerance)) continue;
    // Prepared-food hosts share a produce token ("עוגת לימונים") but must not join.
    if (!queryHeadAnchored(queryText, c.name)) continue;
    // Query specificity (morphology-tolerant). The preserved-form word list is only
    // a fallback for UNLABELED pairs — class+variant already separate pickled/sliced
    // when both are classified.
    if (!queryTokensSatisfied(queryTokens, c.name)) continue;
    if (!bothLabeled(c) && hasUnrequestedPreservedForm(queryTokenSet, c.name)) continue;
    out.push(c);
  }
  return out;
}

export interface AvailabilityEquivalenceOptions {
  maxEquivalents: number;
  packTolerance: number;
  /** Gate penalty at/above which a candidate is an unrequested variant (diet/zero/spicy). */
  penaltyBlock: number;
  /** Penalty score for a candidate id (from the semantic gate). */
  penaltyOf: (productId: string) => number;
}

/**
 * Availability-driven commodity resolution for lines with NO reliable
 * product_class. ~95% of the catalog is unclassified, so a generic commodity
 * query (חומוס, טחינה, מלח גס, אבטיח) is classified "opaque" and forced to a
 * needless confirmation even though every nearby store stocks it. This models
 * the user's intuition — "every store has hummus, just pick one (the cheapest)"
 * — WITHOUT a class signal, by leaning on availability + query specificity:
 *
 * A member must
 *   • be locally available (hasLocalPrice) — availability is the whole point,
 *   • contain every query token as a WHOLE token (specificity; blocks mid-word
 *     host matches like קרח→קרחון and off-intent hits),
 *   • not be a gate-penalized variant (unrequested diet/zero/spicy),
 *   • not be gate-tier 0 (rejected by the semantic gate),
 *   • share the reference member's unit and sit within pack tolerance,
 *   • not disagree on product_class WHEN BOTH have one (class is a positive
 *     signal when present, never required).
 *
 * Returns the ordered set (best-ranked local member first) only when ≥2 qualify
 * — two independent locally-stocked matches is the "widely-carried commodity"
 * signal that separates a real staple from a coincidental token hit. Fewer than
 * two → [] and the caller keeps needs_confirmation.
 */
export function buildAvailabilityEquivalents(
  candidates: BasketCandidate[],
  queryText: string,
  opts: AvailabilityEquivalenceOptions,
): BasketCandidate[] {
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return [];
  const queryTokenSet = new Set(queryTokens);
  // Query-safe (morphology-tolerant), locally-available, non-penalized pool in rank
  // order. Preserved-word guard is a fallback only for unlabeled candidates.
  // Head-anchor drops prepared-food hosts ("עוגת לימונים") that share a produce
  // token but are not the commodity.
  const pool = candidates.filter((c) => {
    if (!c.hasLocalPrice) return false;
    if (opts.penaltyOf(c.productId) >= opts.penaltyBlock) return false;
    if (c.intentTier === 0) return false;
    if (!queryHeadAnchored(queryText, c.name)) return false;
    if (!c.classL1 && hasUnrequestedPreservedForm(queryTokenSet, c.name)) return false;
    return queryTokensSatisfied(queryTokens, c.name);
  });
  if (pool.length < 2) return [];
  const primary = pool[0]!;
  const out: BasketCandidate[] = [primary];
  for (const c of pool) {
    if (out.length > opts.maxEquivalents) break;
    if (c.productId === primary.productId) continue;
    if (!packsCompatible(primary, c, queryText, opts.packTolerance)) continue;
    if (primary.productClass && c.productClass && primary.productClass !== c.productClass) continue;
    if (classesConflict(primary, c)) continue;
    if (variantConflict(primary, c)) continue;
    out.push(c);
  }
  return out.length >= 2 ? out : [];
}
