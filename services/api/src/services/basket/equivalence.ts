import {
  ROLL_PRODUCT_CONTEXT,
  compareClassPaths,
  foldMatresLectionis,
  inferPackSizeFromName,
  isCountUnit,
  normalizeEmbedInput,
  packComposesAmount,
  packSizesCompatible,
  queryTokensSatisfied,
  stemHebrewToken,
  tokenizeNormalized,
} from "@super-mcp/shared";
import { allowsCountToWeight } from "./countWeightPolicy.js";
import { rejectUnsafeChickenName } from "./chickenSafety.js";
import { hasUnrequestedDerivedForm, queryNamesDerivedForm } from "./derivedForm.js";
import { rejectUnsafePlainMilkName } from "./milkSafety.js";
import { rejectUnsafePlainYogurtName } from "./yogurtSafety.js";
import { percentConflict, rejectPercentMismatch } from "./percentAttribute.js";
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

/**
 * The two are different KINDS of thing: the staple versus something made from it or
 * a dish built around it (migration 025 `preparation`).
 *
 * This is the labelled replacement for guessing from names. `class_l3` was supposed
 * to separate these and is absent for most of the catalog, so a plain `אורז` line
 * could price rice PAPER and rice NOODLES, and a plain `יוגורט` line a
 * chocolate-cornflake dessert. `hasUnrequestedDerivedForm` still guards the
 * unlabelled remainder, but a token deny-list is a hazard (one iteration of the
 * roll-count guard mislabelled 196 of 255 matches), so a real label takes precedence
 * wherever one exists.
 *
 * Unknown on either side is NOT a conflict, exactly like `variantConflict`, so
 * behaviour degrades to the previous name-based logic at partial coverage instead of
 * rejecting everything.
 */
/**
 * Coarse grouping: what KIND of thing is this, rather than which flavour?
 *
 * `plain` and `flavoured` are the same food to a shopping list (strawberry yogurt is
 * still yogurt); flavour is what `variant` exists to separate. Only a dish built
 * around the staple, or an ingredient derived from it, is a different kind.
 *
 * Learned by measurement: treating `flavoured` as a conflict shrank equivalence sets
 * and dropped the accuracy benchmark from 78.0% to 71.4% with coverage 91% to 89.3%,
 * because lines fell back to a thinly-stocked primary instead of a stocked peer.
 */
function preparationKind(preparation: string | null | undefined): string | null {
  if (!preparation) return null;
  if (preparation === "plain" || preparation === "flavoured") return "staple";
  return preparation;
}

export function preparationConflict(a: BasketCandidate, b: BasketCandidate): boolean {
  const ka = preparationKind(a.preparation);
  const kb = preparationKind(b.preparation);
  return Boolean(ka && kb && ka !== kb);
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
  // Holders / stands / dispensers. A live basket returned "מחזיק נייר טואלט"
  // (a toilet-roll HOLDER) for "נייר טואלט": the shopper wanted paper and would
  // have gone home with a plastic bracket. The list already had מתקן and מכשיר,
  // so the mechanism was right and only the vocabulary was short.
  "מחזיק", "מחזיקי", "מעמד", "סטנד", "תושבת", "דיספנסר",
  // openers / corkscrews — "יין" must never auto-resolve to "חולץ יין" / "פותחן יין"
  "חולץ", "פותחן", "מחלץ",
  // "derived product OF X" (vinegar/juice/powder/concentrate of X ≠ X)
  "חומץ", "מיץ", "אבקת", "תרכיז", "קמח",
  // prepared-food / dessert hosts — "לימונים" ≠ "עוגת לימונים"; "קולה" ≠ "לקריץ קולה"
  // Include common plurals; queryHeadAnchored also checks stemmed leaders.
  "עוגת", "עוגה", "עוגות", "מאפה", "מאפי", "מאפים", "לקריץ", "סוכריות", "סוכריה",
  "גלידת", "גלידה", "גלידות", "ליקר",
  // stuffed-dough hosts — the DISH is dumplings/ravioli/burekas, not the filling:
  // "בשר" ≠ "כיסונים בשר בקר"; "גבינה" ≠ "בורקס גבינה". Plurals stemmed automatically.
  "כיסונים", "כיסון", "בורקס", "בורקסים", "רביולי", "טורטליני", "ניוקי",
  // rice-shaped pasta — "אורז" ≠ "פתיתים אורז" (ptitim / couscous-rice)
  "פתיתים", "פתיתי",
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

/**
 * Default pack tolerance for treating two SKUs as ONE basket line.
 *
 * Was 0.5 (±50%), which is far too loose for a price comparison: line totals are
 * pack prices, never size-normalized, so a 50% window lets the SMALLER pack win
 * on every line. It grouped `חמאה איטלקית 100 גרם` with `חמאה נורמנדי 125 גרם`
 * (₪119/kg vs ₪97/kg compared as equals) and would pair a 1L oil with 1.5L.
 *
 * 0.15 keeps genuine same-size variation interchangeable (700ml↔750ml = 6.7%,
 * 240g↔250g = 4%) while blocking the 20–50% jumps that flip a cheapest-store
 * verdict: 100g↔125g is 25%, 200g↔300g is 50%, 1L↔1.5L is 50%.
 *
 * Tolerance is measured against the FIRST argument (`|b - a| / a`), i.e. the
 * primary, so the window is anchored on the SKU the shopper's query resolved to.
 */
export const DEFAULT_PACK_TOLERANCE = 0.15;

/** The physical quantity a line asked for, in the shape `isStapleIncompatible` uses. */
export interface RequestedAmount {
  quantity: number;
  unit: string;
}

function packsCompatible(
  a: BasketCandidate,
  b: BasketCandidate,
  queryText: string,
  packTolerance: number,
  requestedAmount?: RequestedAmount | null,
): boolean {
  // Count-sold goods first: `packSizesCompatible` skips tolerance whenever a side
  // is a "1 unit" stub, and 98.5% of the catalog has no piece_count, so eggs and
  // toilet paper reach it as 1-unit stubs and every pack size looks compatible.
  // That is how a 6-pack of eggs was priced for a 12-pack request.
  if (pieceCountsConflict(a, b)) return false;
  // A WEIGHT request is a purchase quantity, not a pack size — the same rule
  // `isStapleIncompatible` already applies one layer up. "1 kg" is 1 kg whether
  // it arrives as two 500g trays or a kilo off the butcher's scale, so admit a
  // peer that can BUILD the amount instead of demanding it resemble the
  // primary's box. Pack similarity cost a shopper ₪26 on a kilo of mince: the
  // ₪63.90/kg counter cut failed `qty_tolerance` against a 500g tray, never
  // became a peer, and was never price-compared.
  //
  // Purely ADDITIVE. Anything that does not compose still faces the old
  // tolerance test unchanged, so this can only widen the peer set. Requiring
  // both sides to compose looked tidier and was wrong: the primary for a generic
  // line is often a unit stub (`בשר טחון`, sizeQty 1, sizeUnit "unit") that
  // composes nothing, which rejected every peer and dropped the line at three
  // stores that had priced it a moment earlier.
  //
  // Not extended to count or volume requests: counts do not compose out of
  // grams, and a volume stated as a pack size is a real constraint ("שמן 1 ל"
  // must not accept 750ml) — the line `isStapleIncompatible` already draws.
  if (requestedAmount && isWeightRequestUnit(requestedAmount.unit)) {
    const want = { amount: requestedAmount.quantity, unit: requestedAmount.unit };
    if (packComposesAmount({ sizeQty: b.sizeQty, sizeUnit: b.sizeUnit, name: b.name }, want)) {
      return true;
    }
  }
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
 * Units per pack, from the explicit field when present and the name otherwise.
 * `inferPackSizeFromName` covers `מארז N` / `N יחידות` / `N יח`; the local
 * patterns add the count idioms it misses — `תבנית 12`, a leading `6 ביצים`, and
 * roll counts (`32 גלילים`, and the glued `פסטל32גל` the feeds emit).
 */
export function packUnitCount(candidate: {
  pieceCount?: number | null;
  sizeQty?: number | null;
  sizeUnit?: string | null;
  name: string;
}): number | null {
  if (candidate.pieceCount != null && Number.isFinite(candidate.pieceCount)) {
    return Math.round(candidate.pieceCount);
  }
  // A real (non-stub) unit size doubles as the pack count.
  if (
    candidate.sizeUnit === "unit" &&
    candidate.sizeQty != null &&
    Number.isFinite(candidate.sizeQty) &&
    candidate.sizeQty > 1
  ) {
    return Math.round(candidate.sizeQty);
  }
  const fromName = inferPieceCountFromName(candidate.name);
  if (fromName != null) return fromName;
  const inferred = inferPackSizeFromName(candidate.name);
  if (inferred && inferred.unit === "unit" && inferred.quantity > 1) {
    return Math.round(inferred.quantity);
  }
  return null;
}

/** True when both sides state a pack count and the counts differ. */
export function pieceCountsConflict(
  a: { pieceCount?: number | null; sizeQty?: number | null; sizeUnit?: string | null; name: string },
  b: { pieceCount?: number | null; sizeQty?: number | null; sizeUnit?: string | null; name: string },
): boolean {
  const left = packUnitCount(a);
  const right = packUnitCount(b);
  if (left == null || right == null) return false;
  return left !== right;
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
  // Compare heads with ktiv doubling collapsed: the feeds spell the same word
  // both ways, and `קורנפלייקס` vs `קורנפלקס` differing by one yod was enough to
  // refuse the very product the shopper asked for.
  const head = foldMatresLectionis(stemHebrewToken(q[0]!));
  const nameRaw = tokenizeNormalized(normalizeEmbedInput(primaryName));
  const first2 = nameRaw.slice(0, 2).map((t) => foldMatresLectionis(stemHebrewToken(t)));
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
  // Moist / wipe forms. `נייר טואלט` resolved to "נייר טואלט לח קידס … 56 דפים" —
  // moist kids' wipes, not paper rolls. Availability cannot separate them (wipes
  // are in 513-567 stores against 651 for rolls), so only a form guard can.
  // Catalog blast radius is small and every hit is a genuine wet-vs-dry
  // distinction the shopper would notice: 44 products carry a standalone `לח`
  // (`תמר לח` moist dates, `מזון חתולים לח` wet cat food), 83 carry `לחים`, 333
  // carry a `מגבונ…` wipe form. Asking for the form keeps it, since the token is
  // then requested.
  "לח",
  "לחה",
  "לחים",
  "לחות",
  "מגבון",
  "מגבוני",
  "מגבונים",
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
  "מרוסק",
  "מרוסקת",
  "מרוסקות",
  "מרוסקים",
  "שימורים",
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

/** Personal-care tokens that must not join a food-oil / grocery staple set. */
const PERSONAL_CARE_TRAP_TOKENS: ReadonlySet<string> = new Set([
  "אמבט",
  "אמבטיה",
  "רחצה",
  "שמפו",
  "קוסמטיקה",
  // "חלב גוף" / "חלב פנים" — body/face lotion, never food milk
  "גוף",
  "פנים",
  "קרם",
  "סבון",
  "אלסבון",
]);

/** L1 classes that are never a food staple primary. */
const NON_FOOD_CLASS_L1: ReadonlySet<string> = new Set([
  "personal_care",
  "household",
  "non_food_other",
]);

/** True when this candidate is a household / personal-care product. */
export function isNonFoodCandidate(candidate: BasketCandidate): boolean {
  const l1 = candidate.classL1 ?? "";
  return l1 !== "" && NON_FOOD_CLASS_L1.has(l1);
}

/** L1/L2 that poison an inferred fresh-produce line. */
const FRESH_PRODUCE_INCOMPATIBLE_L1: ReadonlySet<string> = new Set([
  "canned_preserved",
  "frozen",
  "pantry_dry",
  "snacks_sweets",
  "personal_care",
  "household",
  "non_food_other",
]);

/** A candidate whose name carries a preserved-form token the query did not ask for. */
export function hasUnrequestedPreservedForm(queryTokens: Set<string>, candidateName: string): boolean {
  for (const t of tokenizeNormalized(normalizeEmbedInput(candidateName))) {
    if (PRESERVED_FORM_TOKENS.has(t) && !queryTokens.has(t)) return true;
  }
  return false;
}

/**
 * A peer that adds an ingredient the shopper never mentioned ("עם הל", "עם גרעינים").
 *
 * Structural, not a token list: Hebrew " עם X" and "בטעם X" are the catalogue's
 * own ways of naming an addition, so the pattern generalises to additions nobody
 * has enumerated. "בטעם" earns its place separately: a bare "קפה שחור" was
 * filled with "קפה טורקי בטעם קקאו קינמון", and it is also what separates real
 * maple syrup from "סירופ בטעם מייפל".
 *
 * "בניחוח" (scented) is deliberately NOT here. It reads like the same pattern
 * and is not: every body wash on the shelf is scented, so treating scent as an
 * addition rejected "אל סבון בניחוח לבנדר" — the exact product the last-resort
 * tier exists to recover. It exists because the class map cannot be relied on here — 4,104
 * products whose name carries " עם X" are labelled `variant = regular`, so the
 * exact-variant SQL gate passes them and a bare "קפה שחור" can be filled with
 * cardamom-spiced Turkish coffee.
 *
 * A query that asks for the addition keeps it: only an UNrequested one is
 * rejected, the same rule the preserved-form and personal-care guards apply.
 */
const WITH_INGREDIENT = /(?:^|\s)(?:עם|בטעם)\s+\S+/u;

export function hasUnrequestedAddedIngredient(queryText: string, candidateName: string): boolean {
  if (WITH_INGREDIENT.test(normalizeEmbedInput(queryText))) return false;
  return WITH_INGREDIENT.test(normalizeEmbedInput(candidateName));
}

/** Bath/personal-care tokens the query did not ask for (food-oil ≠ bath oil). */
export function hasUnrequestedPersonalCare(queryTokens: Set<string>, candidateName: string): boolean {
  for (const t of tokenizeNormalized(normalizeEmbedInput(candidateName))) {
    if (PERSONAL_CARE_TRAP_TOKENS.has(t) && !queryTokens.has(t)) return true;
  }
  return false;
}

/**
 * Hard incompatibility between a staple query intent and a candidate — used by
 * equivalence builders and selectSafePrimary before display/pricing primary choice.
 */
export function isStapleIncompatible(
  queryText: string,
  candidate: BasketCandidate,
  opts?: {
    requireFreshProduce?: boolean;
    pieceCount?: number | null;
    requestedAmount?: { quantity: number; unit: string } | null;
    /**
     * The query is itself asking for a household / personal-care product, so the
     * non-food class rejection must not apply. Decided by the caller from the
     * candidate pool — see `filterSafeCandidates`.
     */
    allowNonFood?: boolean;
  },
): boolean {
  const queryTokens = new Set(tokenizeNormalized(normalizeEmbedInput(queryText)));
  // NOTE: `queryTokensSatisfied` is deliberately NOT enforced here, although the
  // commodity-equivalents and coverage-peer paths do enforce it. Requiring every
  // typed word to appear literally in the PRIMARY would defeat semantic retrieval,
  // whose whole purpose is matching a synonym that shares no token. Measured cost
  // of adding it: 8 test failures spanning vector-matched lines and the cross-class
  // confirmation flow. The defect it would fix needs a query word that appears
  // NOWHERE in the catalog (`אבקת כיבוס` matched `אבקת שום` on the shared generic
  // head `אבקת`; `כיבוס` occurs in 0 of 122k products, the feeds spell it
  // `כביסה`), so it is a degenerate input rather than a common one. The safe shape
  // for a future fix is to require token satisfaction only for LEXICALLY matched
  // candidates, leaving vector matches exempt.
  if (hasUnrequestedPreservedForm(queryTokens, candidate.name)) return true;
  if (hasUnrequestedPersonalCare(queryTokens, candidate.name)) return true;
  // A product MADE FROM the staple is not the staple (rice paper / rice noodles /
  // bread crumbs / butter-flavoured margarine).
  //
  // The labelled `preparation` axis (migration 025) is authoritative when present;
  // this name-based guard covers only the unlabelled remainder. Skipping it for
  // labelled candidates matters because a token deny-list mislabels: one iteration
  // of the roll-count guard got 196 of 255 catalog matches wrong. `plain` and
  // `flavoured` are both the staple as far as a generic query is concerned.
  if (candidate.preparation) {
    // Labelled: the label decides. Strictly stronger than the token guard, which
    // only fires when a MARKER WORD appears in the candidate name — so it never
    // caught "יוגורט עם קורנפלקס מצופה שוקולד" (a dessert with no marker token)
    // being priced for a plain יוגורט line. Kept unless the shopper's own wording
    // asks for that form.
    const isDerivedKind =
      candidate.preparation === "derived_ingredient" ||
      candidate.preparation === "prepared_meal";
    if (isDerivedKind && !queryNamesDerivedForm(queryText)) return true;
  } else if (hasUnrequestedDerivedForm(queryText, candidate.name)) {
    return true;
  }
  // An explicitly requested percentage is a hard constraint the shopper stated:
  // "קוטג׳ תנובה 5%" must not resolve to 1%.
  if (rejectPercentMismatch(queryText, candidate.name)) return true;
  if (rejectUnsafePlainMilkName(queryText, candidate.name)) return true;
  if (rejectUnsafePlainYogurtName(queryText, candidate.name, candidate.preparation)) return true;
  if (rejectUnsafeChickenName(queryText, candidate.name)) return true;
  // Head-anchoring stays a soft preference (preferQueryHeadAnchored / override
  // guards). Hard-rejecting every non-anchored name empties shortlists for
  // opaque queries like "מוצר" and incorrectly re-labels them unresolved.

  // Non-food rejection exists so a food query ("שמן") never matches bath oil.
  // But keyed only on personal-care WORDS IN THE QUERY it also killed every
  // genuine household ask: "נייר טואלט" carries no bath vocabulary, its whole
  // candidate pool is class `household`, so all 20 candidates were rejected and
  // the line came back unresolved with an empty shortlist — the entire household
  // aisle was unreachable. `allowNonFood` lets the caller decide from the pool.
  const l1 = candidate.classL1 ?? "";
  if (
    l1 &&
    NON_FOOD_CLASS_L1.has(l1) &&
    !opts?.allowNonFood &&
    !queryTokensHasPersonalCare(queryTokens)
  ) {
    return true;
  }

  if (opts?.requireFreshProduce) {
    if (l1 && FRESH_PRODUCE_INCOMPATIBLE_L1.has(l1)) {
      // flour_baking / tomato paste sit under pantry_dry or canned_preserved
      return true;
    }
    if (candidate.classL2 === "flour_baking" || candidate.classL2 === "frozen_prepared") {
      return true;
    }
    if (candidate.variant === "sliced_prepared") return true;
  }

  if (opts?.pieceCount != null && Number.isFinite(opts.pieceCount)) {
    const got =
      candidate.pieceCount != null && Number.isFinite(candidate.pieceCount)
        ? candidate.pieceCount
        : inferPieceCountFromName(candidate.name);
    if (got != null && got !== opts.pieceCount) return true;
  }

  if (opts?.requestedAmount) {
    // Weight (kg/g) and COUNT (יח/unit) requests are purchase quantities, not pack
    // sizes: "1.5kg tomatoes" and "3 bottles of wine" say how much to buy, and
    // resolvePurchaseQty turns them into packs. Enforcing pack match on them
    // rejected the goods outright — a count request could never satisfy a
    // volume-sized product, so `{amount: 3, unit: "יח"}` for יין dropped every
    // 750ml bottle and omitted the line. An explicit pack COUNT in the query
    // ("ביצים תבנית 12") is a different constraint and is enforced by the
    // `opts.pieceCount` gate above.
    //
    // Volume (L/ml) and mass stated as a pack size still enforce pack match, so
    // "שמן 1 ל" does not accept a 750ml bottle.
    const requestIsPurchaseQuantity =
      isWeightRequestUnit(opts.requestedAmount.unit) || isCountUnit(opts.requestedAmount.unit);
    if (!requestIsPurchaseQuantity && !amountCompatible(opts.requestedAmount, candidate)) {
      return true;
    }
  }

  return false;
}

function isWeightRequestUnit(unit: string): boolean {
  const u = unit
    .trim()
    .toLowerCase()
    .replace(/[׳′]/g, "'")
    .replace(/[״″]/g, '"')
    .replace(/\s+/g, "");
  return (
    u === "kg" ||
    u === "g" ||
    u === "גרם" ||
    u === "גרמים" ||
    u === "קג" ||
    u === 'ק"ג' ||
    u === "ק'ג" ||
    u === "קילו" ||
    u === "קילוגרם"
  );
}

function queryTokensHasPersonalCare(queryTokens: Set<string>): boolean {
  for (const t of queryTokens) {
    if (PERSONAL_CARE_TRAP_TOKENS.has(t)) return true;
  }
  return false;
}

function inferPieceCountFromName(name: string): number | null {
  const n = name.replace(/\s+/g, " ").trim();
  const tray =
    n.match(/תבנית\s*(\d+)/i) ||
    // Leading count is the norm for eggs ("6 ביצים L אומגה", "12 ביצים חופש L").
    // Not anchored to string start: the feeds prefix brands ("מ. ל 12 ביצים").
    n.match(/(?:^|\s)(\d+)\s*ביצ/) ||
    n.match(/(\d+)\s*יח/) ||
    // Roll counts decide toilet-paper/kitchen-towel packs (9 vs 18 vs 32) and the
    // feeds glue them to the number ("נייר טואלט לילי פסטל32גל").
    n.match(/(\d+)\s*גל(?:יל(?:ים)?)?(?![א-ת])/) ||
    // Reversed order, count AFTER the roll noun: "גליל כפול 16", "גלילים 32".
    // Without this the count came back null, and a null count means
    // pieceCountsConflict cannot compare — which paired a 16-roll pack with a
    // 32-roll one as the same basket line, a 2x quantity error that makes the
    // smaller pack look half price. Observed live on
    // "נייר טואלט גליל כפול 16 רמילוי".
    //
    // Gated on ROLL_PRODUCT_CONTEXT because "גליל" is not only "roll": it is also
    // the Galilee region (a standard wine descriptor) and the "פרי גליל" brand.
    // Ungated, this pattern matched 24 products of which 22 were false positives —
    // it read 750 out of `יין אדום מתוק גליל 750 מ"ל` and 7 out of the
    // feed-truncated `יין אדום מתוק גליל 7`, giving two genuinely identical 750ml
    // bottles conflicting pack counts so pieceCountsConflict hard-rejected them as
    // equivalents. Gated, it matches exactly the 2 real roll products and nothing
    // else. (The forward `\d+\s*גל…` form above needs no such gate: a number
    // immediately before the token is already unambiguous.)
    (ROLL_PRODUCT_CONTEXT.test(n)
      ? n.match(/(?<![א-ת])גליל(?:ים)?\s*(?:כפול(?:ים)?|רגיל(?:ים)?)?\s*(\d+)\b/)
      : null);
  if (!tray?.[1]) return null;
  const q = Number(tray[1]);
  return Number.isFinite(q) && q > 0 ? Math.round(q) : null;
}

function amountCompatible(
  requested: { quantity: number; unit: string },
  candidate: BasketCandidate,
): boolean {
  // Unsized SKUs are not rejected here — piece_count / class filters cover eggs;
  // volume mismatches apply only when the candidate carries a usable size.
  if (candidate.sizeQty == null && candidate.sizeUnit == null) return true;
  return packSizesCompatible(
    { sizeQty: requested.quantity, sizeUnit: requested.unit, name: null },
    {
      sizeQty: candidate.sizeQty,
      sizeUnit: candidate.sizeUnit,
      name: candidate.name,
    },
    { packTolerance: 0.1, allowCountToWeight: false },
  ).compatible;
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
  packTolerance = DEFAULT_PACK_TOLERANCE,
  requestedAmount?: RequestedAmount | null,
): BasketCandidate[] {
  if (!top.productClass) return [top];
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return [top];
  const queryTokenSet = new Set(queryTokens);
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.productClass !== top.productClass) continue;
    if (classesConflict(top, c, queryText)) continue; // different L3 (onion≠scallion); bare יין allows color peers
    if (variantConflict(top, c)) continue; // regular≠cherry/zero/organic
    if (preparationConflict(top, c)) continue; // staple ≠ derived/prepared
    // Fat/content percentage is written into the name, never labelled as a
    // variant, so 1% and 9% cottage both read as "regular" without this.
    if (percentConflict(top, c)) continue;
    if (!packsCompatible(top, c, queryText, packTolerance, requestedAmount)) continue;
    // Prepared-food hosts share a produce token ("עוגת לימונים") but must not join.
    if (!queryHeadAnchored(queryText, c.name)) continue;
    // Query specificity (morphology-tolerant). Preserved/personal-care traps are
    // always excluded when the query did not ask for them — class labels alone
    // miss crushed tomatoes / bath oil mis-tagged as the staple class.
    if (!queryTokensSatisfied(queryTokens, c.name)) continue;
    if (hasUnrequestedPreservedForm(queryTokenSet, c.name)) continue;
    if (hasUnrequestedPersonalCare(queryTokenSet, c.name)) continue;
    if (hasUnrequestedDerivedForm(queryText, c.name)) continue;
    if (rejectPercentMismatch(queryText, c.name)) continue;
    if (rejectUnsafeChickenName(queryText, c.name)) continue;
    if (rejectUnsafePlainMilkName(queryText, c.name)) continue;
    if (rejectUnsafePlainYogurtName(queryText, c.name, c.preparation)) continue;
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
  /**
   * Physical quantity the line asked for, when it asked for one. Safe to honour
   * here now that `restrictToDominantClassL2` decides the primary: widening the
   * peer test used to change whether this branch fired at all, which is how a
   * beef line became ₪159.60 of Beyond Meat.
   */
  requestedAmount?: RequestedAmount | null;
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
/**
 * Share of the classified pool the leading `classL2` must hold before it is
 * treated as "the" class. Below this the labels are simply disagreeing.
 *
 * A safety bound on a noisy inference, not a tuned optimum: the benchmark scores
 * identically at 0.7 and at 0.0 (always narrow to the mode), so nothing in it
 * exercises a near-even split. Kept because L2 labels are LLM-assigned and
 * chopping a 51/49 pool to its mode would be a guess presented as a fact.
 */
const DOMINANT_CLASS_MIN_SHARE = 0.7;

/**
 * Drop minority-class candidates before a primary is picked from rank order.
 *
 * This path takes `pool[0]` as the primary with no class test, which is fine
 * while every candidate is the same kind of thing and wrong the moment one is
 * not. Live defect: "בשר טחון" ranked "בשר טחון ביונד מיט" (plant-based,
 * `classL2: meat_processed`) first, so the line priced ₪159.60 of Beyond Meat
 * while every other candidate in the pool was `beef`.
 *
 * It stayed hidden because the narrow pack gate starved this branch below its
 * two-peer minimum, so it bailed out and another path answered. The wrong
 * primary was already being selected; a coincidence suppressed it. Widening the
 * pack rule without this un-masks it, which is why this lands first.
 *
 * Keyed on `classL2`, because the offender agrees at `classL1` (`meat_fish` for
 * both beef and a vegan patty) — which is why the existing
 * `restrictToDominantClass` could not catch it.
 *
 * A null class is kept, never counted as a minority: unknown is not a
 * disagreement anywhere else in this file, and ~95% of the catalog is
 * unclassified, so treating null as odd-one-out would empty the pool.
 */
/**
 * The class a clear majority of classified candidates agree on, or null.
 *
 * Null when the labels are split, because these labels are LLM-assigned and
 * noisy: a near-even split means the labels disagree, not that half the pool is
 * the wrong food. Unclassified candidates are not counted at all, in either
 * direction — ~95% of the catalog is unlabelled, so treating null as a
 * disagreement would empty every pool.
 */
export function dominantClassAmong(
  pool: BasketCandidate[],
  classOf: (c: BasketCandidate) => string | null | undefined,
): string | null {
  const counts = new Map<string, number>();
  for (const c of pool) {
    const cls = classOf(c);
    if (cls) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  // Sort by name first so an exact tie resolves deterministically.
  let winner: string | null = null;
  let winnerCount = 0;
  for (const [cls, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > winnerCount) {
      winner = cls;
      winnerCount = n;
    }
  }
  if (!winner) return null;
  const classified = [...counts.values()].reduce((n, v) => n + v, 0);
  return winnerCount / classified < DOMINANT_CLASS_MIN_SHARE ? null : winner;
}

export function restrictToDominantClassL2(pool: BasketCandidate[]): BasketCandidate[] {
  const distinct = new Set(pool.map((c) => c.classL2).filter(Boolean));
  if (distinct.size < 2) return pool;
  // Only act on a CLEAR majority. Narrowing on every split cost two benchmark
  // lines: חומוס and אבקת כביסה each spread across two L2 labels, and chopping
  // to the mode threw away better-stocked peers, dropping both below their
  // availability floor. A vegan patty among beef is 3-of-18, nothing like an
  // even split.
  const winner = dominantClassAmong(pool, (c) => c.classL2);
  if (!winner) return pool;
  const kept = pool.filter((c) => !c.classL2 || c.classL2 === winner);
  // Never shrink below the two-peer commodity signal on a class guess alone.
  return kept.length >= 2 ? kept : pool;
}

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
  const rawPool = candidates.filter((c) => {
    if (!c.hasLocalPrice) return false;
    if (opts.penaltyOf(c.productId) >= opts.penaltyBlock) return false;
    if (c.intentTier === 0) return false;
    if (!queryHeadAnchored(queryText, c.name)) return false;
    if (hasUnrequestedPreservedForm(queryTokenSet, c.name)) return false;
    if (hasUnrequestedPersonalCare(queryTokenSet, c.name)) return false;
    if (hasUnrequestedDerivedForm(queryText, c.name)) return false;
    if (rejectPercentMismatch(queryText, c.name)) return false;
    if (rejectUnsafeChickenName(queryText, c.name)) return false;
    if (rejectUnsafePlainMilkName(queryText, c.name)) return false;
    if (rejectUnsafePlainYogurtName(queryText, c.name, c.preparation)) return false;
    return queryTokensSatisfied(queryTokens, c.name);
  });
  // Before pool[0] becomes the primary, drop candidates that are a different
  // KIND of thing from the bulk of the pool.
  const pool = restrictToDominantClassL2(rawPool);
  if (pool.length < 2) return [];
  const primary = pool[0]!;
  const out: BasketCandidate[] = [primary];
  for (const c of pool) {
    if (out.length > opts.maxEquivalents) break;
    if (c.productId === primary.productId) continue;
    if (!packsCompatible(primary, c, queryText, opts.packTolerance, opts.requestedAmount)) continue;
    if (primary.productClass && c.productClass && primary.productClass !== c.productClass) continue;
    if (classesConflict(primary, c)) continue;
    if (variantConflict(primary, c)) continue;
    if (preparationConflict(primary, c)) continue;
    if (percentConflict(primary, c)) continue;
    out.push(c);
  }
  return out.length >= 2 ? out : [];
}
