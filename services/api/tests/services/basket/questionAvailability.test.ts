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

const BRAND_PINNED_STATUS: BasketItemStatus = {
  index: 0,
  qty: 1,
  qtyMode: "packs",
  amount: null,
  unit: null,
  productId: null,
  name: "טייסטרס צ'ויס",
  resolved: false,
  resolvedBy: "query",
  resolutionStatus: "needs_confirmation",
  confidence: null,
  lowConfidence: true,
  candidates: [
    candidate({
      productId: "tasters",
      name: "נסקפה טייסטרס צ'ויס 200ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "טסטרס צ'ויס",
      score: 0.95,
    }),
    candidate({
      productId: "elite",
      name: "קפה נמס עלית",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "עלית",
      score: 0.8,
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

  it("brand-pinned shortlist uses selectionEffect=brand_family (family resume)", () => {
    const questions = buildBasketQuestions(
      [{ query: "קפה טסטרס צויס", packQty: 1 }],
      [BRAND_PINNED_STATUS],
      new Map([
        ["tasters", { pricedStoreCount: 4, chainCount: 2, minPrice: 28 }],
        ["elite", { pricedStoreCount: 5, chainCount: 3, minPrice: 18 }],
      ]),
      3,
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]?.selectionEffect).toBe("brand_family");
    expect(questions[0]?.options.map((option) => option.productId)).toContain("tasters");
  });

  it("opaque or cross-class shortlists also pin rather than broaden", () => {
    const opaque: BasketItemStatus = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: null,
      name: "משהו",
      resolved: false,
      resolvedBy: "query",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      substitution: null,
      candidates: [
        candidate({
          productId: "opaque-a",
          name: "מוצר א",
          productClass: null,
          score: 0.7,
        }),
        candidate({
          productId: "opaque-b",
          name: "מוצר ב",
          productClass: null,
          score: 0.6,
        }),
      ],
    };
    const questions = buildBasketQuestions(
      [{ query: "משהו", packQty: 1 }],
      [opaque],
      new Map([
        ["opaque-a", { pricedStoreCount: 1, chainCount: 1, minPrice: 10 }],
        ["opaque-b", { pricedStoreCount: 1, chainCount: 1, minPrice: 9 }],
      ]),
      3,
    );
    expect(questions[0]?.selectionEffect).toBe("pin");
  });
});

describe("question shortlist keeps the everyday variant in front", () => {
  // The resolution ranking already prefers `regular` over a labeled variant, on
  // the principle that a bare product word means the ordinary household version.
  // The question shortlist is a separate ranking and did not, so as soon as two
  // more chains made the `premium` barista pack the most widely stocked Taster's
  // nearby it headed the options list and every caller that takes the first
  // locally-priced option got the specialty jar.
  const tasters: BasketItemStatus = {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: null,
    name: "טייסטרס צ׳ויס",
    resolved: false,
    resolvedBy: "query",
    resolutionStatus: "needs_confirmation",
    confidence: null,
    lowConfidence: true,
    candidates: [
      candidate({
        productId: "barista",
        name: "קפה טייסטרס צ`ויס בריסטה נסקפה (200 גרם)",
        productClass: "instant_coffee",
        variant: "premium",
        score: 0.8,
      }),
      candidate({
        productId: "original",
        name: "נסקפה טייסטרס צויס 100 גר אוריגנל",
        productClass: "instant_coffee",
        variant: "regular",
        score: 0.8,
      }),
    ],
  };

  it("puts the regular jar ahead of a premium one that is stocked more widely", () => {
    const questions = buildBasketQuestions(
      [{ query: "טייסטרס צ׳ויס", packQty: 1 }],
      [tasters],
      new Map([
        // The premium pack leads on every availability signal, which is exactly
        // the case that used to decide the order on its own.
        ["barista", { pricedStoreCount: 43, chainCount: 7, minPrice: 25 }],
        ["original", { pricedStoreCount: 30, chainCount: 4, minPrice: 30 }],
      ]),
      3,
    );
    expect(questions[0]?.options.map((o) => o.productId)).toEqual(["original", "barista"]);
  });

  it("still puts a locally stocked premium ahead of a regular nobody nearby carries", () => {
    // Availability outranks the variant preference: offering a jar no nearby
    // store sells would trade one wrong answer for a worse one.
    const questions = buildBasketQuestions(
      [{ query: "טייסטרס צ׳ויס", packQty: 1 }],
      [tasters],
      new Map([
        ["barista", { pricedStoreCount: 43, chainCount: 7, minPrice: 25 }],
        ["original", { pricedStoreCount: 0, chainCount: 0, minPrice: null }],
      ]),
      3,
    );
    expect(questions[0]?.options.map((o) => o.productId)).toEqual(["barista", "original"]);
  });
});
