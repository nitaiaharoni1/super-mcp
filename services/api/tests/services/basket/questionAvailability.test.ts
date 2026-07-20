import { describe, expect, it } from "vitest";
import { buildBasketQuestions } from "../../../src/services/basket/questionAvailability.js";
import type { BasketCandidate, BasketItemStatus } from "../../../src/services/basket/types.js";

function candidate(
  over: Partial<BasketCandidate> & { productId: string; name: string },
): BasketCandidate {
  return {
    score: 0.8,
    matchedVia: "product",
    sizeQty: 1,
    sizeUnit: "unit",
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: null,
    intentTier: 1,
    ...over,
  };
}

const AMBIGUOUS_STATUS: BasketItemStatus = {
  index: 0,
  qty: 2,
  qtyMode: "packs",
  amount: 20,
  unit: "יח",
  productId: null,
  name: "פיתות",
  resolved: false,
  resolvedBy: "query",
  resolutionStatus: "needs_confirmation",
  confidence: null,
  lowConfidence: true,
  candidates: [
    candidate({
      productId: "local-wide",
      name: "פיתות 10 יח",
      pieceCount: 10,
      score: 0.7,
      productClass: "bakery",
      classL1: "bakery",
    }),
    candidate({
      productId: "local-narrow",
      name: "פיתות 8 יח",
      pieceCount: 8,
      score: 0.9,
      productClass: "bakery",
      classL1: "bakery",
    }),
    candidate({
      productId: "unavailable",
      name: "פיתות מיוחדות",
      pieceCount: 6,
      score: 0.95,
      hasLocalPrice: false,
      productClass: "bakery",
      classL1: "bakery",
    }),
  ],
  substitution: null,
};

describe("buildBasketQuestions", () => {
  it("orders safe local options by availability, chain diversity, price, then score", () => {
    const questions = buildBasketQuestions(
      [{ query: "פיתות", amount: 20, unit: "יח" }],
      [AMBIGUOUS_STATUS],
      new Map([
        ["local-wide", { pricedStoreCount: 5, chainCount: 3, minPrice: 12 }],
        ["local-narrow", { pricedStoreCount: 2, chainCount: 1, minPrice: 9 }],
        ["unavailable", { pricedStoreCount: 0, chainCount: 0, minPrice: null }],
      ]),
      3,
    );
    expect(questions[0]?.options.map((option) => option.productId)).toEqual([
      "local-wide",
      "local-narrow",
      "unavailable",
    ]);
    expect(questions[0]?.options[0]?.pack.pieceCount).toBe(10);
    expect(questions[0]?.selectionEffect).toBe("representative");
  });
});
