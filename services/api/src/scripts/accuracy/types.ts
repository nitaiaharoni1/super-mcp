/**
 * Accuracy benchmark contract.
 *
 * Scores whether a basket answer is CORRECT, which no existing test does. The
 * current suite asserts the absence of bugs already found, which is how a
 * roll-count pattern with 196 catalog false positives passed its author's own
 * verification: the check confirmed what it assumed.
 *
 * Labels never name product ids. The catalog is reingested and ids churn, so a
 * label pins the PROPERTIES a correct answer must have. That also means a label
 * can be judged by a human reading it, without a database.
 */

/** Cross-cutting preparation axis (migration 025). Mirrors PREPARATIONS in shared. */
export type Preparation = "plain" | "flavoured" | "prepared_meal" | "derived_ingredient";

export interface AcceptCriteria {
  /**
   * Every token must appear in the resolved product name (substring match on the
   * raw Hebrew, so morphology is the label author's problem, not the scorer's).
   * Use for the head noun a correct answer cannot omit.
   */
  requireTokens?: string[];
  /**
   * At least ONE token must appear. For staples with genuine synonyms, where
   * `requireTokens` (which is AND) would reject a correct answer: פסטה and
   * ספגטי are both pasta.
   */
  requireAnyToken?: string[];
  /**
   * If any token appears, the resolution is wrong. This is where the real failures
   * live: `אורז` matching `דפי אורז` (rice paper) or `מנה חמה נודלס` (instant
   * noodles), `יוגורט` matching a chocolate dessert.
   */
  forbidTokens?: string[];
  /**
   * Same as `forbidTokens` but matched as a regex, for the case a plain substring
   * cannot express: a forbidden word that is also part of a legitimate BRAND.
   *
   * Real example. `oil-cooking` must reject olive oil, so it forbade `זית`. But
   * `עץ הזית` is a brand of CANOLA oil, so 11 correct products were scored wrong.
   * Tightening to the phrase `שמן זית` is not right either: the catalog spells it
   * `שמן  זית`, `שמןזית` and `ש.זית` on 4 real olive oils, which would then pass.
   * `(?<!עץ ה)זית` is the rule that is actually meant, and it classifies all 15
   * correctly.
   */
  forbidPatterns?: string[];
  /** Resolved product must sit in one of these class_l2 buckets. */
  anyOfClassL2?: string[];
  /** Resolved product's preparation must be one of these, when classified. */
  anyOfPreparation?: Preparation[];
  /**
   * Minimum SHARE (0..1) of serving storefronts that must price the resolved SKU.
   * A name-perfect match carried by one store is a worse answer than a looser
   * match carried by most of them, and this is the axis the availability upgrade
   * exists for.
   *
   * A share, not a count, because the denominator moves. It moved a long way: it
   * was 143 physical branches within 10km of Herzliya, and since the ingest
   * narrowed to storefronts it is the 7 or 8 that deliver to the benchmark
   * address. An absolute threshold calibrated on national counts false-failed
   * correct answers in the first run of this harness.
   *
   * **These thresholds are calibrated for the old denominator and are now
   * coarse.** Against 143 branches, 0.25 separated a widely stocked SKU (71% for
   * eggs, 97% for pasta) from a real failure (0.7%, a one-store bread). Against
   * 8 storefronts the same 0.25 is "at least 2 of 8", and one storefront either
   * way flips the verdict. Treat an availability failure as a hint, not a
   * finding, until the thresholds are re-derived on storefront counts.
   */
  minNearbyStoreShare?: number;
}

export interface StapleLabel {
  /** Stable id so a baseline diff survives reordering. */
  id: string;
  /** What a shopper types. */
  query: string;
  packQty?: number;
  amount?: number;
  unit?: string;
  /** Grouping for per-category scoring (usually the expected class_l2). */
  category: string;
  accept: AcceptCriteria;
  /** Why this label is written the way it is; the first thing a reviewer reads. */
  notes: string;
  /**
   * Author's confidence that this label is correct as written.
   * high   = unambiguous staple, wording verified against catalog names
   * medium = the query is common but the acceptable set is a judgement call
   * low    = genuinely ambiguous in Hebrew; a human must decide
   */
  confidence: "high" | "medium" | "low";
}

export interface BenchmarkBasket {
  id: string;
  /** Human name of the shopping occasion. */
  name: string;
  /** Label ids composing this basket. */
  labelIds: string[];
  /** Free-text location, resolved the way a real caller would send it. */
  location: string;
}

/** One scored basket line. */
export interface LineScore {
  labelId: string;
  query: string;
  category: string;
  resolvedName: string | null;
  resolutionStatus: string;
  /** Nearby branches pricing the resolved SKU, when measurable. */
  nearbyStores: number | null;
  /** Nearby branches in scope, the denominator for the share test. */
  nearbyStoreTotal: number | null;
  accepted: boolean;
  /** Why it failed, for diagnosis rather than a bare number. */
  failures: string[];
  priced: boolean;
  clubOnly: boolean;
  couponOnly: boolean;
}

export interface BasketScore {
  basketId: string;
  name: string;
  requestedLines: number;
  /** Lines whose resolution satisfied its label. */
  acceptedLines: number;
  /** Lines priced at the recommended store. */
  pricedLines: number;
  clubOnlyLines: number;
  couponOnlyLines: number;
  imputedLines: number;
  comparableTotal: number | null;
  storeName: string | null;
  elapsedMs: number;
  lines: LineScore[];
  error?: string;
}

export interface BenchmarkMetrics {
  /** Fraction of lines resolving to something the label accepts. */
  resolutionAccuracy: number;
  /** Fraction of requested lines priced at the recommended store. */
  coverage: number;
  /** Fraction of priced lines needing a club card or a coupon. */
  conditionalExposure: number;
  /** imputedLines / pricedLines: how much of the headline total is estimated. */
  imputedShare: number;
  /**
   * Every requested line across ALL baskets, failed ones included. This is the
   * denominator, so two runs are only comparable when it matches.
   */
  requestedLines: number;
  /**
   * Baskets that threw. Their lines count against `resolutionAccuracy` and
   * `coverage`, so a crash lowers the score instead of shrinking the denominator.
   */
  erroredBaskets: number;
}

export interface BenchmarkReport {
  /** Populated after the run, not inside the harness (scripts must stay pure). */
  generatedAt: string;
  labelCount: number;
  basketCount: number;
  metrics: BenchmarkMetrics;
  /** resolutionAccuracy per category, so a regression is localisable. */
  byCategory: Record<string, { total: number; accepted: number; accuracy: number }>;
  baskets: BasketScore[];
}
