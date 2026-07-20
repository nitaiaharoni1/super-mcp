import {
  DEFAULT_DISTANCE_PENALTY_PER_KM,
  effectiveCost,
} from "../../services/basket/recommendStores.js";
import type { BasketOptimizeResult, BasketStoreResult } from "../../services/basket/types.js";

export function summarizeQuestions(
  result: Extract<BasketOptimizeResult, { status: "needs_confirmation" }>,
) {
  return {
    status: result.status,
    questionCount: result.questions.length,
    questions: result.questions.map((q) => ({
      itemIndex: q.itemIndex,
      id: q.id,
      selectionEffect: q.selectionEffect,
      options: q.options.map((o) => ({
        productId: o.productId,
        name: o.name,
        nearbyPricedStores: o.nearbyPricedStores,
        nearbyPricedChains: o.nearbyPricedChains,
        pack: o.pack,
      })),
    })),
    preview: result.preview,
  };
}

export function summarizeComplete(result: Extract<BasketOptimizeResult, { status: "complete" }>) {
  const qtyDecisions = result.items.map((item) => ({
    index: item.index,
    name: item.name,
    qty: item.qty,
    qtyMode: item.qtyMode,
    amount: item.amount,
    unit: item.unit,
    resolutionStatus: item.resolutionStatus,
  }));

  // Effective-cost ranking so the geo-anchored single-store pick is auditable.
  const distanceRanking = [...result.stores]
    .map((s) => ({
      storeName: `${s.chainName} / ${s.storeName}`,
      total: s.total,
      distanceKm: s.distanceKm,
      effectiveCost:
        Math.round(
          effectiveCost(s, { distancePenaltyPerKm: DEFAULT_DISTANCE_PENALTY_PER_KM }) * 100,
        ) / 100,
      itemsFound: s.itemsFound,
    }))
    .sort((a, b) => a.effectiveCost - b.effectiveCost)
    .slice(0, 5);

  return {
    status: result.status,
    bestSingleStore: result.bestSingleStore
      ? {
          storeId: result.bestSingleStore.storeId,
          chainName: result.bestSingleStore.chainName,
          storeName: result.bestSingleStore.storeName,
          distanceKm: result.bestSingleStore.distanceKm,
          pricedLines: result.bestSingleStore.pricedLines,
          resolvableLines: result.bestSingleStore.resolvableLines,
          requestedLines: result.bestSingleStore.requestedLines,
          coverageRatio: result.bestSingleStore.coverageRatio,
          total: result.bestSingleStore.total,
          missingItemIndexes: result.bestSingleStore.missingItems.map((m) => m.itemIndex),
        }
      : null,
    distanceRanking,
    cheapestCompleteStore: result.cheapestCompleteStore
      ? {
          storeId: result.cheapestCompleteStore.storeId,
          chainName: result.cheapestCompleteStore.chainName,
          storeName: result.cheapestCompleteStore.storeName,
          pricedLines: result.cheapestCompleteStore.pricedLines,
          coverageRatio: result.cheapestCompleteStore.coverageRatio,
          total: result.cheapestCompleteStore.total,
        }
      : null,
    multiStore: result.multiStore
      ? {
          pricedLines: result.multiStore.pricedLines,
          coverageRatio: result.multiStore.coverageRatio,
          total: result.multiStore.total,
          storeCount: result.multiStore.storeCount,
          missingItemIndexes: result.multiStore.missingItemIndexes,
          storeNames: [
            ...new Set(
              result.multiStore.lines.map((line) => `${line.chainName} / ${line.storeName}`),
            ),
          ],
        }
      : null,
    qtyDecisions,
    storesCompared: result.storesCompared,
  };
}

export function lineCoverage(store: BasketStoreResult, itemIndex: number) {
  const line = store.lines.find((l) => l.itemIndex === itemIndex);
  const missing = store.missingItems.find((m) => m.itemIndex === itemIndex);
  return {
    priced: Boolean(line),
    productId: line?.productId ?? null,
    name: line?.name ?? null,
    unitPrice: line?.unitPrice ?? null,
    lineTotal: line?.lineTotal ?? null,
    freshness: line?.freshness ?? null,
    missingReason: missing?.reason ?? null,
  };
}

/** Prefer locally priced options; fall back to first option. Never invent product IDs. */
export function pickAnswers(
  result: Extract<BasketOptimizeResult, { status: "needs_confirmation" }>,
): Array<{ itemIndex: number; productId: string }> {
  return result.questions.map((q) => {
    const local = q.options.find((o) => o.nearbyPricedStores > 0);
    const pick = local ?? q.options[0];
    if (!pick) {
      throw new Error(`canary: question ${q.id} has no options`);
    }
    return { itemIndex: q.itemIndex, productId: pick.productId };
  });
}
