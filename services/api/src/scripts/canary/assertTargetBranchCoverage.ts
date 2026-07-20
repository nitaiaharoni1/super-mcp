import type { BasketOptimizeResult } from "../../services/basket/types.js";
import { lineCoverage } from "./basketCanaryReport.js";
import { TAHINI_INDEX, TASTERS_INDEX, WINE_INDEX } from "./bbqBasketFixture.js";

export function assertTargetBranchCoverage(
  result: Extract<BasketOptimizeResult, { status: "complete" }>,
  storeId: string,
): Record<string, unknown> {
  const store = result.stores.find((s) => s.storeId === storeId);
  if (!store) {
    throw new Error(
      `canary: target store ${storeId} absent from verbose store results ` +
        `(compared ${result.storesCompared}; returned ${result.stores.length})`,
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
  if (!tasters.priced) {
    throw new Error(
      `canary: Taster's Choice not priced at ${store.storeName} (${storeId}): ${
        tasters.missingReason ?? "unknown"
      }`,
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
