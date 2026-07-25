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
    costs.set(store.storeId, {
      comparableTotal: round2(store.total + imputedTotal),
      imputedTotal: round2(imputedTotal),
      imputedLines,
      clubOnlyLines,
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
  };
}
