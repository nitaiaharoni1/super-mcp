import { describe, expect, it } from "vitest";
import { buildBasketIntentProfile } from "../../../src/services/basket/intentProfile.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

const cand = (over: Partial<BasketCandidate>): BasketCandidate => ({
  productId: "p1",
  name: "בצל",
  score: 1,
  matchedVia: "product",
  sizeQty: 1,
  sizeUnit: "unit",
  pieceCount: null,
  hasPrice: false,
  hasLocalPrice: false,
  productClass: "produce",
  classL1: "produce",
  classL2: "vegetable_fresh",
  classL3: "onion",
  variant: "regular",
  ...over,
});

describe("buildBasketIntentProfile", () => {
  it("prefers free-text query over primary name and enables produce count↔weight", () => {
    const profile = buildBasketIntentProfile(
      { query: "בצלים", amount: 3, unit: "יח" },
      cand({ name: "בצל שופרסל" }),
    );
    expect(profile.queryText).toBe("בצלים");
    expect(profile.hasFreeTextQuery).toBe(true);
    expect(profile.mode).toBe("commodity");
    expect(profile.requestedCanonUnit).toBe("unit");
    expect(profile.allowCountToWeight).toBe(true);
  });

  it("honors intentModeOverride and pins product_id-only as exact", () => {
    expect(
      buildBasketIntentProfile(
        {
          productId: "pita-10",
          query: "פיתות",
          amount: 20,
          unit: "יח",
          intentModeOverride: "commodity",
        },
        cand({
          name: "פיתות 10",
          productClass: "bakery",
          classL1: "bakery",
          classL2: "pita_flatbread",
          classL3: "pita",
        }),
      ).mode,
    ).toBe("commodity");
    expect(
      buildBasketIntentProfile({ productId: "tasters", packQty: 1 }, cand({ name: "טייסטרס" }))
        .mode,
    ).toBe("exact");
    expect(
      buildBasketIntentProfile(
        { productId: "coke-zero", query: "קולה זירו", packQty: 1, intentModeOverride: "exact" },
        cand({
          name: "קוקה קולה זירו",
          productClass: "beverage",
          classL1: "beverage",
          variant: "diet_zero",
        }),
      ).mode,
    ).toBe("exact");
  });

  it("enables count↔weight for pita_flatbread but not generic bakery/bread", () => {
    const pita = buildBasketIntentProfile(
      { query: "פיתות", amount: 20, unit: "יח" },
      cand({
        name: "פיתות עננים",
        productClass: "bakery",
        classL1: "bakery",
        classL2: "pita_flatbread",
        classL3: "pita",
      }),
    );
    expect(pita.allowCountToWeight).toBe(true);
    const bread = buildBasketIntentProfile(
      { query: "לחם", packQty: 1 },
      cand({
        name: "לחם אחיד",
        productClass: "bakery",
        classL1: "bakery",
        classL2: "bread",
        classL3: null,
        sizeUnit: "unit",
        sizeQty: 1,
      }),
    );
    expect(bread.allowCountToWeight).toBe(false);
  });

  it("keeps pantry goods strict (no count↔weight)", () => {
    const profile = buildBasketIntentProfile(
      { query: "מלח גס", packQty: 1 },
      cand({
        name: "מלח גס",
        productClass: "pantry_dry",
        classL1: "pantry_dry",
        classL2: "spices_seasoning",
        classL3: "salt",
        sizeUnit: "g",
        sizeQty: 1000,
      }),
    );
    expect(profile.allowCountToWeight).toBe(false);
  });

  it("does not treat a bare commodity noun as an extracted brand pin", () => {
    const profile = buildBasketIntentProfile(
      { query: "קולה", packQty: 1 },
      cand({
        name: "קולה 1.5 ליטר",
        productClass: "beverage",
        classL1: "beverage",
        classL2: "soda",
        classL3: "cola",
        variant: "regular",
        brandExtracted: "קולה",
      }),
    );

    expect(profile.mode).toBe("commodity");
  });

  it("treats a named multi-token brand query as brand_family", () => {
    const profile = buildBasketIntentProfile(
      { query: "טייסטרס צ׳ויס", packQty: 1 },
      cand({
        name: "נסקפה טייסטרס צ'ויס 95ג",
        productClass: "beverage",
        classL1: "beverage",
        classL2: "coffee",
        classL3: "instant_coffee",
        variant: "regular",
        brandExtracted: "טייסטרס צ'ויס",
        sizeQty: 95,
        sizeUnit: "g",
      }),
    );
    expect(profile.mode).toBe("brand_family");
  });

  it("honors brand_family intentModeOverride after confirmation", () => {
    expect(
      buildBasketIntentProfile(
        {
          productId: "tasters-95",
          query: "טייסטרס צ׳ויס",
          packQty: 1,
          intentModeOverride: "brand_family",
        },
        cand({
          name: "נסקפה טייסטרס צ'ויס 95ג",
          productClass: "beverage",
          classL1: "beverage",
          classL2: "coffee",
          classL3: "instant_coffee",
          brandExtracted: "טייסטרס צ'ויס",
          sizeQty: 95,
          sizeUnit: "g",
        }),
      ).mode,
    ).toBe("brand_family");
  });

  it("enables count↔volume for wine bottles asked by יח", () => {
    const wine = cand({
      name: "יין אדום",
      productClass: "alcohol",
      classL1: "alcohol",
      classL2: "wine",
      classL3: "red_wine",
      sizeQty: 1,
      sizeUnit: "unit",
    });
    expect(
      buildBasketIntentProfile({ query: "יין", amount: 3, unit: "יח" }, wine).allowCountToWeight,
    ).toBe(true);
    expect(
      buildBasketIntentProfile({ query: "יין", packQty: 3 }, wine).allowCountToWeight,
    ).toBe(true);
    // Explicit volume request stays strict (do not bridge kg/liter oddities).
    expect(
      buildBasketIntentProfile({ query: "יין", amount: 0.75, unit: "l" }, wine).allowCountToWeight,
    ).toBe(false);
  });
});
