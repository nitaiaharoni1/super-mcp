import type {
  AcceptCriteria,
  BasketScore,
  BenchmarkMetrics,
  BenchmarkReport,
  LineScore,
  StapleLabel,
} from "./types.js";

/**
 * Pure scoring. No database, no network, no clock.
 *
 * Everything the scorer cannot read off the basket response (a product's class,
 * its preparation, how many nearby stores price it) arrives as `ProductFacts`
 * supplied by the caller. That keeps this file unit-testable without a catalog,
 * which matters because a benchmark whose own scorer is untested is just a
 * differently-shaped guess.
 */

/** What the caller looks up per resolved product id. */
export interface ProductFacts {
  classL2: string | null;
  preparation: string | null;
  nearbyStores: number | null;
}

export type FactsLookup = (productId: string) => ProductFacts | undefined;

/** Minimal shape of the basket response the scorer reads. */
export interface ScorableBasket {
  items: Array<{
    index: number;
    productId: string | null;
    name: string | null;
    resolutionStatus: string;
  }>;
  bestSingleStore: {
    storeName: string;
    comparableTotal: number;
    imputedLines: number;
    lines: Array<{
      itemIndex: number;
      clubOnly?: boolean;
      couponOnly?: boolean;
    }>;
  } | null;
}

/**
 * Judge one resolution against its label. Returns every reason it failed rather
 * than the first, so a regression report names the cause instead of a boolean.
 */
export function evaluateAccept(
  accept: AcceptCriteria,
  resolvedName: string | null,
  facts: ProductFacts | undefined,
  /** Nearby branches in scope; without it the share test is skipped. */
  nearbyStoreTotal?: number | null,
): string[] {
  const failures: string[] = [];
  if (resolvedName == null) return ["unresolved"];

  for (const token of accept.requireTokens ?? []) {
    if (!resolvedName.includes(token)) failures.push(`missing required token "${token}"`);
  }
  const anyTokens = accept.requireAnyToken ?? [];
  if (anyTokens.length > 0 && !anyTokens.some((t) => resolvedName.includes(t))) {
    failures.push(`none of the accepted tokens present: ${anyTokens.join(", ")}`);
  }
  for (const token of accept.forbidTokens ?? []) {
    if (resolvedName.includes(token)) failures.push(`forbidden token "${token}"`);
  }
  for (const pattern of accept.forbidPatterns ?? []) {
    // A malformed pattern throws here, propagates out of scoreBasket and aborts the
    // whole run at the CLI's top-level handler. That is deliberate: silently
    // accepting everything would be worse. Patterns are compile-checked by a test
    // (`every forbidPattern compiles`) so this should never fire in practice.
    if (new RegExp(pattern).test(resolvedName)) {
      failures.push(`forbidden pattern "${pattern}"`);
    }
  }

  // Class / preparation / availability are only checkable when facts were supplied.
  // A missing fact is NOT a failure: an unclassified catalog must not score as wrong,
  // or the benchmark would punish exactly the gap it exists to measure.
  if (accept.anyOfClassL2 && facts?.classL2 != null) {
    if (!accept.anyOfClassL2.includes(facts.classL2)) {
      failures.push(`class_l2 "${facts.classL2}" not in ${accept.anyOfClassL2.join("|")}`);
    }
  }
  if (accept.anyOfPreparation && facts?.preparation != null) {
    if (!accept.anyOfPreparation.includes(facts.preparation as never)) {
      failures.push(`preparation "${facts.preparation}" not in ${accept.anyOfPreparation.join("|")}`);
    }
  }
  if (
    accept.minNearbyStoreShare != null &&
    facts?.nearbyStores != null &&
    nearbyStoreTotal != null &&
    nearbyStoreTotal > 0
  ) {
    const share = facts.nearbyStores / nearbyStoreTotal;
    if (share < accept.minNearbyStoreShare) {
      failures.push(
        `stocked in ${facts.nearbyStores}/${nearbyStoreTotal} nearby branches ` +
          `(${(share * 100).toFixed(0)}%), need ${(accept.minNearbyStoreShare * 100).toFixed(0)}%`,
      );
    }
  }
  return failures;
}

export function scoreBasket(input: {
  basketId: string;
  name: string;
  labels: StapleLabel[];
  response: ScorableBasket;
  facts: FactsLookup;
  elapsedMs: number;
  /** Nearby branches in scope, denominator for minNearbyStoreShare. */
  nearbyStoreTotal?: number | null;
}): BasketScore {
  const { basketId, name, labels, response, facts, elapsedMs, nearbyStoreTotal } = input;
  const plan = response.bestSingleStore;
  const pricedByIndex = new Map(
    (plan?.lines ?? []).map((line) => [line.itemIndex, line]),
  );

  const lines: LineScore[] = labels.map((label, index) => {
    const item = response.items.find((i) => i.index === index);
    const productFacts = item?.productId ? facts(item.productId) : undefined;
    const failures = evaluateAccept(label.accept, item?.name ?? null, productFacts, nearbyStoreTotal);
    const priced = pricedByIndex.get(index);
    return {
      labelId: label.id,
      query: label.query,
      category: label.category,
      resolvedName: item?.name ?? null,
      resolutionStatus: item?.resolutionStatus ?? "missing",
      nearbyStores: productFacts?.nearbyStores ?? null,
      nearbyStoreTotal: nearbyStoreTotal ?? null,
      accepted: failures.length === 0,
      failures,
      priced: priced != null,
      clubOnly: priced?.clubOnly === true,
      couponOnly: priced?.couponOnly === true,
    };
  });

  return {
    basketId,
    name,
    requestedLines: labels.length,
    acceptedLines: lines.filter((l) => l.accepted).length,
    pricedLines: lines.filter((l) => l.priced).length,
    clubOnlyLines: lines.filter((l) => l.clubOnly).length,
    couponOnlyLines: lines.filter((l) => l.couponOnly).length,
    imputedLines: plan?.imputedLines ?? 0,
    comparableTotal: plan?.comparableTotal ?? null,
    storeName: plan?.storeName ?? null,
    elapsedMs,
    lines,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export function aggregate(baskets: BasketScore[]): BenchmarkMetrics {
  const scored = baskets.filter((b) => !b.error);
  const errored = baskets.filter((b) => b.error);
  // The denominator is EVERY requested line, including those in baskets that failed.
  // Dropping a failed basket from both sides made a crash look free: one erroring
  // 9-line basket silently took the denominator from 100 to 91, which made two runs
  // look 4 points apart when they differed by a single line. A benchmark must never
  // reward the system for being unable to answer.
  const requested = baskets.reduce((n, b) => n + b.requestedLines, 0);
  const accepted = scored.reduce((n, b) => n + b.acceptedLines, 0);
  const priced = scored.reduce((n, b) => n + b.pricedLines, 0);
  const conditional = scored.reduce(
    (n, b) => n + b.lines.filter((l) => l.priced && (l.clubOnly || l.couponOnly)).length,
    0,
  );
  const imputed = scored.reduce((n, b) => n + b.imputedLines, 0);
  return {
    resolutionAccuracy: ratio(accepted, requested),
    coverage: ratio(priced, requested),
    conditionalExposure: ratio(conditional, priced),
    imputedShare: ratio(imputed, priced),
    // Surfaced so a run whose score moved because a basket failed is never mistaken
    // for a run whose accuracy moved.
    requestedLines: requested,
    erroredBaskets: errored.length,
  };
}

export function byCategory(
  baskets: BasketScore[],
): BenchmarkReport["byCategory"] {
  const out: BenchmarkReport["byCategory"] = {};
  for (const basket of baskets) {
    for (const line of basket.lines) {
      const bucket = (out[line.category] ??= { total: 0, accepted: 0, accuracy: 0 });
      bucket.total += 1;
      if (line.accepted) bucket.accepted += 1;
    }
  }
  for (const bucket of Object.values(out)) {
    bucket.accuracy = ratio(bucket.accepted, bucket.total);
  }
  return out;
}

/** Metric names where a DROP is a regression (all of these are "higher is better"). */
export const HIGHER_IS_BETTER: ReadonlyArray<keyof BenchmarkMetrics> = [
  "resolutionAccuracy",
  "coverage",
];

/**
 * Compare a run against a baseline. `conditionalExposure` and `imputedShare` are
 * deliberately NOT gated: they describe the catalog and the promo landscape as much
 * as the code, so failing a build on them would punish a data refresh.
 */
export function findRegressions(
  current: BenchmarkMetrics,
  baseline: BenchmarkMetrics,
  tolerance: number,
): string[] {
  const out: string[] = [];
  for (const key of HIGHER_IS_BETTER) {
    const delta = current[key] - baseline[key];
    if (delta < -tolerance) {
      out.push(
        `${key} regressed ${baseline[key].toFixed(4)} -> ${current[key].toFixed(4)} (${delta.toFixed(4)})`,
      );
    }
  }
  return out;
}
