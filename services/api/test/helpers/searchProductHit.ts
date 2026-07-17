import { HE_RETAIL } from "@super-mcp/shared/test-utils";
import type { SearchProductHit } from "../../src/services/search/types.js";

export function makeSearchProductHit(
  partial: Partial<SearchProductHit> & Pick<SearchProductHit, "id" | "name">,
): SearchProductHit {
  return {
    gtin: null,
    brand: null,
    categoryL1: null,
    categoryL2: null,
    sizeQty: null,
    sizeUnit: null,
    score: 0.9,
    matchedVia: "product",
    hasPrice: true,
    hasLocalPrice: false,
    ...partial,
  };
}

/** Regression fixture: Herzliya פרגיות — global-only vs local twins. */
export function herzliyaParagiyotHits(): SearchProductHit[] {
  return [
    makeSearchProductHit({
      id: "rami-internal",
      name: HE_RETAIL.product.freshChickenThighs,
      sizeQty: 1000,
      sizeUnit: "g",
      score: 0.95,
      hasLocalPrice: false,
    }),
    makeSearchProductHit({
      id: "gtin-pack",
      gtin: "7290000616896",
      name: HE_RETAIL.product.freshChickenThighsPack,
      sizeQty: 1000,
      sizeUnit: "g",
      score: 0.82,
      matchedVia: "listing",
      hasLocalPrice: true,
    }),
    makeSearchProductHit({
      id: "stop-market",
      name: HE_RETAIL.product.freshChickenThighs,
      score: 0.9,
      hasLocalPrice: true,
    }),
  ];
}

/** Unit fixture: local fresh twin beats global-only and frozen alternatives. */
export function freshThighRankingHits(): SearchProductHit[] {
  return [
    makeSearchProductHit({
      id: "global",
      name: HE_RETAIL.product.freshChickenThighs,
      score: 0.95,
      hasLocalPrice: false,
    }),
    makeSearchProductHit({
      id: "local",
      name: HE_RETAIL.product.freshChickenThighsPack,
      score: 0.8,
      hasLocalPrice: true,
    }),
    makeSearchProductHit({
      id: "frozen",
      name: HE_RETAIL.product.frozenChickenThighs,
      score: 0.85,
      hasLocalPrice: true,
    }),
  ];
}
