import type { BasketStoreResult, ComparableCost } from "./types.js";

/**
 * Make per-store totals comparable before ranking them.
 *
 * Every store prices a different subset of the basket, so a raw `total`
 * systematically favours the store that stocks the least. Reproduced live in
 * Herzliya: `bestSingleStore` reported ₪92.86 against a ₪171.42 rival, and the
 * entire ₪78 gap was one tuna line the "cheaper" store did not carry. A shopper
 * following that recommendation still has to buy the tuna.
 *
 * So each store is restated on the same basket: what it charges for the lines it
 * stocks, plus a market reference price for the resolvable lines it does not.
 * The reference is the MEDIAN line total across the stores that do price the
 * line — median rather than mean so one mispriced or club-only outlier cannot
 * move it, and rather than min/max so imputation neither flatters nor punishes
 * low-coverage stores.
 *
 * Lines that no store prices are skipped: they are missing everywhere, so they
 * add the same constant to every store and cannot change the ranking.
 */

/** Median of a non-empty numeric list (average of the middle pair when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Market reference price per item index, from the stores actually being compared.
 * Exported for tests and for callers that want to explain an imputed figure.
 */
export function buildReferenceLinePrices(
  storeResults: BasketStoreResult[],
): Map<number, number> {
  const byItem = new Map<number, number[]>();
  for (const store of storeResults) {
    for (const line of store.lines) {
      // Skip a line with no usable total. Pricing guarantees a positive lineTotal,
      // but a single non-finite value here would make the median NaN, and a NaN
      // comparableTotal loses every numeric comparison — collapsing the sort back
      // onto its coverage tie-breaker, i.e. silently restoring the very bug this
      // module exists to fix. Fail visibly small rather than invisibly wrong.
      if (!Number.isFinite(line.lineTotal)) continue;
      const bucket = byItem.get(line.itemIndex);
      if (bucket) bucket.push(line.lineTotal);
      else byItem.set(line.itemIndex, [line.lineTotal]);
    }
  }
  const reference = new Map<number, number>();
  for (const [itemIndex, totals] of byItem) {
    reference.set(itemIndex, median(totals));
  }
  return reference;
}

/**
 * How far above the other stores' median a single line may sit before it is
 * treated as a mismatch rather than a price.
 *
 * Measured case: "נייר טואלט" resolved correctly, and six storefronts priced it
 * between ₪34.50 and ₪45.90 while Shufersal returned a ₪350 catering case, which
 * put that chain at ₪460 instead of ₪136 and inverted the ranking. The substitute
 * survived every existing filter because both its size record and the primary's
 * are wrong: the primary lost its roll count (stored as "1 unit", its name
 * truncated mid-word) and the case claims to be 1 unit of 1000g, so the pack-size
 * check saw two compatible singles.
 *
 * Cross-store agreement is the signal that survives bad catalogue data, because
 * the other storefronts resolved the same line from the same query independently.
 * A genuine price difference for one line between Israeli chains is well under
 * 2x; 6x is far outside anything real and only fires on a substitution error.
 */
export const IMPLAUSIBLE_LINE_MULTIPLE = 6;

/**
 * A median needs enough independent opinions to be one. With two stores there is
 * no majority, so an 6x gap is equally consistent with one absurd substitute and
 * one genuine bargain, and dropping the wrong side would invent a cheap basket
 * that does not exist.
 */
const MIN_STORES_FOR_OUTLIER_JUDGEMENT = 3;

/**
 * Discard per-store lines that cost a wild multiple of what everyone else charges
 * for the same line.
 *
 * This is a backstop for substitution, not a pricing rule. It deliberately judges
 * a line only against the SAME line at other storefronts, never against a global
 * price table for its category: fresh produce and household goods have legitimate
 * 8x spreads within a category (a measured attempt at the category-median version
 * would have stripped 24 bell peppers and 15 milks), whereas the same shopping
 * line resolved at six chains should not.
 *
 * A dropped line becomes a line that storefront does not price, which the
 * comparable-cost machinery below already models: the store is charged the market
 * reference for it and its pricedLines count falls. That is the honest outcome.
 * Reporting a ₪350 substitute as if the shopper wanted it is not.
 */
export function dropImplausibleLines(
  storeResults: BasketStoreResult[],
): { results: BasketStoreResult[]; dropped: number } {
  const reference = buildReferenceLinePrices(storeResults);
  const storesPerItem = new Map<number, number>();
  for (const store of storeResults) {
    for (const line of store.lines) {
      if (!Number.isFinite(line.lineTotal)) continue;
      storesPerItem.set(line.itemIndex, (storesPerItem.get(line.itemIndex) ?? 0) + 1);
    }
  }

  let dropped = 0;
  const results = storeResults.map((store) => {
    const kept = store.lines.filter((line) => {
      const median = reference.get(line.itemIndex);
      const voters = storesPerItem.get(line.itemIndex) ?? 0;
      if (median == null || !(median > 0)) return true;
      if (voters < MIN_STORES_FOR_OUTLIER_JUDGEMENT) return true;
      if (!Number.isFinite(line.lineTotal)) return true;
      if (line.lineTotal <= median * IMPLAUSIBLE_LINE_MULTIPLE) return true;
      dropped += 1;
      return false;
    });
    if (kept.length === store.lines.length) return store;
    const removedTotal = store.lines
      .filter((line) => !kept.includes(line))
      .reduce((sum, line) => sum + (Number.isFinite(line.lineTotal) ? line.lineTotal : 0), 0);
    return { ...store, lines: kept, total: round2(store.total - removedTotal) };
  });

  return { results, dropped };
}

/**
 * Comparable cost per store id.
 *
 * `priceableItemIndexes` is the set of lines at least one compared store prices;
 * a store is charged the reference price for every one of those it misses.
 */
export function buildComparableCosts(
  storeResults: BasketStoreResult[],
): Map<string, ComparableCost> {
  const reference = buildReferenceLinePrices(storeResults);
  const costs = new Map<string, ComparableCost>();

  for (const store of storeResults) {
    const priced = new Set(
      store.lines.filter((line) => Number.isFinite(line.lineTotal)).map((line) => line.itemIndex),
    );
    let imputedTotal = 0;
    let imputedLines = 0;
    for (const [itemIndex, referencePrice] of reference) {
      if (priced.has(itemIndex)) continue;
      imputedTotal += referencePrice;
      imputedLines += 1;
    }
    const clubOnlyLines = store.lines.reduce(
      (count, line) => count + (line.clubOnly ? 1 : 0),
      0,
    );
    const couponOnlyLines = store.lines.reduce(
      (count, line) => count + (line.couponOnly ? 1 : 0),
      0,
    );
    costs.set(store.storeId, {
      comparableTotal: round2(store.total + imputedTotal),
      imputedTotal: round2(imputedTotal),
      imputedLines,
      clubOnlyLines,
      couponOnlyLines,
    });
  }
  return costs;
}

/** Fully-observed cost for a store absent from the map (pure unit-test convenience). */
export function comparableCostFor(
  store: BasketStoreResult,
  costs: Map<string, ComparableCost> | undefined,
): ComparableCost {
  const found = costs?.get(store.storeId);
  if (found) return found;
  return {
    comparableTotal: store.total,
    imputedTotal: 0,
    imputedLines: 0,
    clubOnlyLines: store.lines.reduce((count, line) => count + (line.clubOnly ? 1 : 0), 0),
    couponOnlyLines: store.lines.reduce((count, line) => count + (line.couponOnly ? 1 : 0), 0),
  };
}
