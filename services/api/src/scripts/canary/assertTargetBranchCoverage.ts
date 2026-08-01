import type { BasketOptimizeResult } from "../../services/basket/types.js";
import { lineCoverage } from "./basketCanaryReport.js";
import { TAHINI_INDEX, TASTERS_INDEX, WINE_INDEX } from "./bbqBasketFixture.js";

/**
 * Share of the basket the target branch must price for the canary to pass.
 *
 * What this canary is for is a branch that is PRESENT and PRICED being reported
 * as serving nothing: Neve Amal's Carrefour was, because the neighbourhood
 * geocoded to a post office five kilometres away. That failure takes a branch to
 * zero or near-zero priced lines, so a floor catches it.
 *
 * A floor, and not "this branch stocks this SKU", because those are different
 * claims and only the first is a bug. See TASTERS_INDEX below.
 */
const MIN_TARGET_BRANCH_COVERAGE = 0.6;

export function assertTargetBranchCoverage(
  result: Extract<BasketOptimizeResult, { status: "complete" }>,
  storeId: string,
): Record<string, unknown> {
  const stores = result.stores ?? [];
  const store = stores.find((s) => s.storeId === storeId);
  if (!store) {
    throw new Error(
      `canary: target store ${storeId} absent from verbose store results ` +
        `(compared ${result.storesCompared}; returned ${stores.length})`,
    );
  }
  const tahini = lineCoverage(store, TAHINI_INDEX);
  const wine = lineCoverage(store, WINE_INDEX);
  const tasters = lineCoverage(store, TASTERS_INDEX);
  if (!tahini.priced) {
    throw new Error(
      `canary: tahini not priced at ${store.storeName} (${storeId}): ${tahini.missingReason ?? "unknown"}`,
    );
  }
  if (!wine.priced) {
    throw new Error(
      `canary: wine not priced at ${store.storeName} (${storeId}): ${wine.missingReason ?? "unknown"}`,
    );
  }
  // Taster's is deliberately NOT asserted as priced, and the basket is asserted
  // as a whole instead.
  //
  // The confirmation picker chooses from options that carry a NEARBY priced-store
  // count, never a per-branch one, so which Taster's it lands on is not something
  // this branch's stock can steer. This branch prices four of the eleven Taster's
  // products in the catalogue; a pick outside those four is a real retail fact,
  // not a defect, and asserting otherwise made the canary fail twice for reasons
  // that were nothing to do with what it guards. First `not_carried_by_chain`,
  // when two new chains shifted which variant led the shortlist, and then
  // `no_price_data`, when a national ingest reconciled this branch's stock.
  //
  // Tahini and wine stay hard assertions: both are staples every branch carries,
  // so their absence still means the branch is not being read properly.
  const coverage = store.itemsFound / Math.max(result.items?.length ?? 0, 1);
  if (coverage < MIN_TARGET_BRANCH_COVERAGE) {
    throw new Error(
      `canary: ${store.storeName} (${storeId}) priced only ${store.itemsFound} of ` +
        `${result.items?.length ?? 0} lines (${(coverage * 100).toFixed(0)}%, floor ` +
        `${MIN_TARGET_BRANCH_COVERAGE * 100}%) — a branch found but barely priced is the ` +
        `geocode failure this canary exists for`,
    );
  }
  const tastersLine = store.lines.find((l) => l.itemIndex === TASTERS_INDEX);
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    chainName: store.chainName,
    pricedLines: store.itemsFound,
    missingCount: store.missingItems.length,
    tahini,
    wine,
    tasters: {
      ...tasters,
      originalProductId: tastersLine?.originalProductId ?? null,
      substitutionReason: tastersLine?.substitutionReason ?? null,
    },
  };
}
