import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BasketCandidate,
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "../../../src/services/basket/types.js";

const resolveItems = vi.fn();
const listStores = vi.fn();
const loadBasketPricingData = vi.fn();
const loadCandidateAvailability = vi.fn();

vi.mock("../../../src/services/basket/resolve.js", () => ({
  resolveItems: (...args: unknown[]) => resolveItems(...args),
}));

vi.mock("../../../src/services/stores/index.js", () => ({
  listStores: (...args: unknown[]) => listStores(...args),
}));

vi.mock("../../../src/services/basket/loadPricingData.js", () => ({
  loadBasketPricingData: (...args: unknown[]) => loadBasketPricingData(...args),
  loadCandidateAvailability: (...args: unknown[]) => loadCandidateAvailability(...args),
}));

vi.mock("../../../src/services/search/ontology.js", () => ({
  getActiveOntology: vi.fn().mockResolvedValue(null),
}));

// Bypass DB peer fetch — we attach equivalents on the resolved items directly.
vi.mock("../../../src/services/basket/commodityCoverage.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/services/basket/commodityCoverage.js")>(
    "../../../src/services/basket/commodityCoverage.js",
  );
  return {
    ...actual,
    enrichCommodityCoverage: async (
      items: unknown[],
      resolved: ResolvedItem[],
      _storeIds: string[],
    ) => {
      for (const item of resolved) {
        const input = (
          items as Array<{
            query?: string;
            productId?: string;
            intentModeOverride?: string;
          }>
        )[item.index];
        if (input?.intentModeOverride === "brand_family" || item.intentMode === "brand_family") {
          item.intentMode = "brand_family";
          continue;
        }
        if (input?.intentModeOverride === "exact" || (input?.productId && !input.query)) {
          item.intentMode = "exact";
          continue;
        }
        item.intentMode = "commodity";
      }
    },
  };
});

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

const OPTIONS = { continuationSecret: "test-only-basket-continuation-secret-ok" };
const CHAIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEVE_AMAL = "e0099e24-af29-49c0-976d-97e15c398436";
const OTHER_STORE = "11111111-1111-4111-8111-111111111111";

function cand(
  over: Partial<BasketCandidate> & { productId: string; name: string },
): BasketCandidate {
  return {
    score: 0.95,
    matchedVia: "product",
    sizeQty: 500,
    sizeUnit: "g",
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "spreads_condiments",
    classL1: "spreads_condiments",
    classL2: "hummus_tahini_salads",
    classL3: "tahini",
    variant: "regular",
    ...over,
  };
}

function wine(
  over: Partial<BasketCandidate> & { productId: string; name: string; classL3: string },
): BasketCandidate {
  return {
    score: 0.95,
    matchedVia: "product",
    sizeQty: 750,
    sizeUnit: "ml",
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "alcohol",
    classL1: "alcohol",
    classL2: "wine",
    variant: "regular",
    ...over,
  };
}

function listing(id: string, productId: string, name: string): ListingRow {
  return {
    id,
    product_id: productId,
    chain_id: CHAIN,
    item_code: id,
    name,
    gtin: null,
  };
}

function price(listingId: string, storeId: string, value: number): [string, StorePriceRow] {
  return [
    `${listingId}:${storeId}`,
    {
      listing_id: listingId,
      store_id: storeId,
      price: String(value),
      currency: "ILS",
      source_ts: "2026-07-18T00:00:00Z",
      ingested_at: "2026-07-18T00:00:00Z",
    },
  ];
}

describe("Neve Amal local commodity coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockResolvedValue(new Map());
    listStores.mockResolvedValue([
      {
        id: NEVE_AMAL,
        chainId: CHAIN,
        chainName: "קרפור",
        storeCode: "4170",
        name: "בעיר נווה עמל (4170)",
        address: "נווה עמל",
        city: "הרצליה",
        zip: null,
        lat: null,
        lng: null,
        geoSource: "address",
        distanceKm: 0.5,
      },
      {
        id: OTHER_STORE,
        chainId: CHAIN,
        chainName: "קרפור",
        storeCode: "1",
        name: "סניף אחר",
        address: null,
        city: "הרצליה",
        zip: null,
        lat: null,
        lng: null,
        geoSource: "address",
        distanceKm: 2,
      },
    ]);
  });

  it("prices tahini via a local peer when the representative has no Neve Amal price", async () => {
    const ahva = cand({ productId: "ahva", name: "טחינה אחוה 500ג" });
    const local = cand({ productId: "local-tahini", name: "טחינה גולמית 500ג" });
    const tahini: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: 0.5,
      unit: "kg",
      productId: "ahva",
      name: ahva.name,
      resolvedBy: "query",
      resolutionStatus: "resolved",
      intentMode: "commodity",
      confidence: 0.95,
      lowConfidence: false,
      candidates: [ahva],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
      equivalents: [ahva, local],
    };

    resolveItems.mockResolvedValue([tahini]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN,
          new Map([
            ["ahva", [listing("L-ahva", "ahva", ahva.name)]],
            ["local-tahini", [listing("L-local", "local-tahini", local.name)]],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map([
        // Ahva priced only at the other store.
        ...[price("L-ahva", OTHER_STORE, 12)],
        ...[price("L-local", NEVE_AMAL, 9.9)],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket(
      {
        items: [{ query: "טחינה", amount: 0.5, unit: "kg" }],
        city: "הרצליה",
        verbose: true,
        storesLimit: 0,
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    const neve = result.stores.find((s) => s.storeId === NEVE_AMAL);
    expect(neve).toBeDefined();
    expect(neve!.missingItems).toEqual([]);
    expect(neve!.lines[0]?.productId).toBe("local-tahini");
    expect(neve!.lines[0]?.unitPrice).toBe(9.9);
  });

  it("commodity wine picks the cheaper white when the red representative is also stocked", async () => {
    const red = wine({ productId: "red", name: "יין אדום קברנה", classL3: "red_wine" });
    const white = wine({ productId: "white", name: "יין לבן יבש", classL3: "white_wine" });
    const item: ResolvedItem = {
      index: 0,
      qty: 3,
      qtyMode: "packs",
      amount: 3,
      unit: "יח",
      productId: "red",
      name: red.name,
      resolvedBy: "query",
      resolutionStatus: "resolved",
      intentMode: "commodity",
      confidence: 0.95,
      lowConfidence: false,
      candidates: [red],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
      equivalents: [red, white],
    };

    resolveItems.mockResolvedValue([item]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN,
          new Map([
            ["red", [listing("L-red", "red", red.name)]],
            ["white", [listing("L-white", "white", white.name)]],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map([
        ...[price("L-red", NEVE_AMAL, 49.9)],
        ...[price("L-white", NEVE_AMAL, 29.9)],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket(
      {
        items: [{ query: "יין", amount: 3, unit: "יח" }],
        city: "הרצליה",
        verbose: true,
        storesLimit: 0,
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    const neve = result.stores.find((s) => s.storeId === NEVE_AMAL);
    expect(neve!.lines[0]?.productId).toBe("white");
    expect(neve!.lines[0]?.unitPrice).toBe(29.9);
  });

  it("brand_family Taster's prices the local compatible pack and surfaces larger pack as alternative", async () => {
    const selected = cand({
      productId: "tasters-95",
      name: "נסקפה טייסטרס צ'ויס 95ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "טייסטרס צ'ויס",
      sizeQty: 95,
      sizeUnit: "g",
    });
    const local100 = cand({
      productId: "tasters-100",
      name: "נסקפה טייסטרס צ'ויס מקורי 100ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "טייסטרס צ'ויס",
      sizeQty: 100,
      sizeUnit: "g",
    });
    const local200 = cand({
      productId: "tasters-200",
      name: "נסקפה טייסטרס צ'ויס 200ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "טייסטרס צ'ויס",
      sizeQty: 200,
      sizeUnit: "g",
    });
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "tasters-95",
      name: selected.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      intentMode: "brand_family",
      confidence: 1,
      lowConfidence: false,
      candidates: [selected],
      primaryProductId: "tasters-95",
      primaryName: selected.name,
      substitution: null,
      equivalents: [selected, local100],
      alternatives: [local200],
    };

    resolveItems.mockResolvedValue([item]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN,
          new Map([
            ["tasters-95", [listing("L-95", "tasters-95", selected.name)]],
            ["tasters-100", [listing("L-100", "tasters-100", local100.name)]],
            ["tasters-200", [listing("L-200", "tasters-200", local200.name)]],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map([
        // Selected 95g listing exists on chain but not at Neve Amal.
        ...[price("L-95", OTHER_STORE, 34)],
        ...[price("L-100", NEVE_AMAL, 31.9)],
        ...[price("L-200", NEVE_AMAL, 39.9)],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket(
      {
        items: [
          {
            productId: "tasters-95",
            query: "טייסטרס צ׳ויס",
            packQty: 1,
            intentModeOverride: "brand_family",
          },
        ],
        city: "הרצליה",
        verbose: true,
        storesLimit: 0,
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    const neve = result.stores.find((s) => s.storeId === NEVE_AMAL);
    expect(neve).toBeDefined();
    expect(neve!.lines[0]?.productId).toBe("tasters-100");
    expect(neve!.lines[0]?.substituted).toBe(true);
    expect(neve!.lines[0]?.substitutionReason).toMatch(/brand_family_equivalent/);
    expect(neve!.lines[0]?.originalProductId).toBe("tasters-95");
    expect(neve!.missingItems).toEqual([]);
  });

  it("brand_family with only a larger pack reports alternative_available", async () => {
    const selected = cand({
      productId: "tasters-95",
      name: "נסקפה טייסטרס צ'ויס 95ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "טייסטרס צ'ויס",
      sizeQty: 95,
      sizeUnit: "g",
    });
    const local200 = cand({
      productId: "tasters-200",
      name: "נסקפה טייסטרס צ'ויס 200ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      brandExtracted: "טייסטרס צ'ויס",
      sizeQty: 200,
      sizeUnit: "g",
    });
    const salt = cand({
      productId: "salt",
      name: "מלח גס",
      productClass: "pantry_dry",
      classL1: "pantry_dry",
      classL2: "spices_seasoning",
      classL3: "salt",
      sizeQty: 1000,
      sizeUnit: "g",
    });
    const coffee: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "tasters-95",
      name: selected.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      intentMode: "brand_family",
      confidence: 1,
      lowConfidence: false,
      candidates: [selected],
      primaryProductId: "tasters-95",
      primaryName: selected.name,
      substitution: null,
      equivalents: [selected],
      alternatives: [local200],
    };
    const saltItem: ResolvedItem = {
      index: 1,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "salt",
      name: salt.name,
      resolvedBy: "query",
      resolutionStatus: "resolved",
      intentMode: "commodity",
      confidence: 1,
      lowConfidence: false,
      candidates: [salt],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
      equivalents: [salt],
    };

    resolveItems.mockResolvedValue([coffee, saltItem]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN,
          new Map([
            ["tasters-95", [listing("L-95", "tasters-95", selected.name)]],
            ["tasters-200", [listing("L-200", "tasters-200", local200.name)]],
            ["salt", [listing("L-salt", "salt", salt.name)]],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map([
        ...[price("L-95", OTHER_STORE, 34)],
        ...[price("L-200", NEVE_AMAL, 39.9)],
        ...[price("L-salt", NEVE_AMAL, 3.9)],
        ...[price("L-salt", OTHER_STORE, 3.9)],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket(
      {
        items: [
          {
            productId: "tasters-95",
            query: "טייסטרס צ׳ויס",
            packQty: 1,
            intentModeOverride: "brand_family",
          },
          { query: "מלח גס", packQty: 1 },
        ],
        city: "הרצליה",
        verbose: true,
        storesLimit: 0,
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    const neve = result.stores.find((s) => s.storeId === NEVE_AMAL);
    expect(neve).toBeDefined();
    expect(neve!.lines.map((l) => l.productId)).toEqual(["salt"]);
    expect(neve!.missingItems).toEqual([
      {
        itemIndex: 0,
        productId: "tasters-95",
        name: selected.name,
        reason: "alternative_available",
        alternative: {
          productId: "tasters-200",
          name: local200.name,
          sizeQty: 200,
          sizeUnit: "g",
          pieceCount: null,
        },
      },
    ]);
  });

  it("exact SKU without a branch price stays missing with no_price_data", async () => {
    const tasters = cand({
      productId: "tasters",
      name: "טייסטרס צ׳ויס",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      sizeQty: 200,
      sizeUnit: "g",
    });
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "tasters",
      name: tasters.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      intentMode: "exact",
      confidence: 1,
      lowConfidence: false,
      candidates: [tasters],
      primaryProductId: "tasters",
      primaryName: tasters.name,
      substitution: null,
    };

    resolveItems.mockResolvedValue([item]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [CHAIN, new Map([["tasters", [listing("L-t", "tasters", tasters.name)]]])],
      ]),
      // Listing exists for the chain but no Neve Amal store_price.
      priceByListingAndStore: new Map([price("L-t", OTHER_STORE, 32)]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket(
      {
        items: [{ productId: "tasters", packQty: 1 }],
        city: "הרצליה",
        verbose: true,
        storesLimit: 0,
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    // Stores with zero priced lines are dropped by priceStoreBasket; Neve Amal
    // must not appear as a successful basket for this exact SKU.
    expect(result.stores.map((s) => s.storeId)).not.toContain(NEVE_AMAL);
    expect(result.bestSingleStore?.storeId).toBe(OTHER_STORE);
    expect(result.bestSingleStore?.lines[0]?.productId).toBe("tasters");
  });
});
