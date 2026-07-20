import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BasketCandidate,
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "../../../src/services/basket/types.js";

/**
 * Regression: prepare→confirm→optimize with product_id must still broaden
 * classified lines to per-chain equivalents. Without that, Carrefour/Shufersal
 * show not_carried_by_chain for a Stop-Market tomato UUID.
 */

const resolveItems = vi.fn();
const listStores = vi.fn();
const loadBasketPricingData = vi.fn();
const loadCandidateAvailability = vi.fn();
const enrichCommodityCoverage = vi.fn();

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
vi.mock("../../../src/services/basket/commodityCoverage.js", () => ({
  enrichCommodityCoverage: (...args: unknown[]) => enrichCommodityCoverage(...args),
}));
vi.mock("../../../src/services/search/ontology.js", () => ({
  getActiveOntology: vi.fn().mockResolvedValue(null),
}));

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

const OPTIONS = { continuationSecret: "test-only-basket-continuation-secret-ok" };

const CHAIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STORE_A = "11111111-1111-4111-8111-000000000001";
const STORE_B = "22222222-2222-4222-8222-000000000001";
const TOMATO_A = "a0000000-0000-4000-8000-000000000001";
const TOMATO_B = "b0000000-0000-4000-8000-000000000001";
const TASTERS = "c0000000-0000-4000-8000-000000000001";
const TURKISH_COFFEE = "c0000000-0000-4000-8000-000000000002";
const COKE_ZERO = "c0000000-0000-4000-8000-000000000003";
const COKE_REGULAR = "c0000000-0000-4000-8000-000000000004";
const GTIN_PRODUCT = "c0000000-0000-4000-8000-000000000005";
const GTIN_PEER = "c0000000-0000-4000-8000-000000000006";
const LISTING_A = "d4444444-4444-4444-8444-000000000001";
const LISTING_B = "e4444444-4444-4444-8444-000000000001";
const LISTING_TASTERS = "d4444444-4444-4444-8444-000000000011";
const LISTING_TURKISH = "d4444444-4444-4444-8444-000000000012";
const LISTING_COKE_ZERO = "d4444444-4444-4444-8444-000000000013";
const LISTING_COKE_REG = "d4444444-4444-4444-8444-000000000014";
const LISTING_GTIN = "d4444444-4444-4444-8444-000000000015";
const LISTING_GTIN_PEER = "d4444444-4444-4444-8444-000000000016";

function cand(over: Partial<BasketCandidate> & { productId: string; name: string }): BasketCandidate {
  return {
    score: 1,
    matchedVia: "product",
    sizeQty: 1000,
    sizeUnit: "g",
    pieceCount: null,
    hasPrice: false,
    hasLocalPrice: false,
    productClass: "produce",
    classL1: "produce",
    classL2: "vegetable_fresh",
    classL3: "tomato",
    variant: "regular",
    ...over,
  };
}

describe("product_id confirmations still get equivalent coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockResolvedValue(new Map());
    listStores.mockResolvedValue([
      {
        id: STORE_A,
        chainId: CHAIN_A,
        chainName: "רשת א",
        storeCode: "1",
        name: "סניף א",
        address: "רחוב א",
        city: "הרצליה",
        zip: null,
        lat: 32.16,
        lng: 34.84,
        geoSource: "address",
        distanceKm: 2,
      },
      {
        id: STORE_B,
        chainId: CHAIN_B,
        chainName: "רשת ב",
        storeCode: "1",
        name: "סניף ב נווה עמל",
        address: "כצנלסון 19",
        city: "הרצליה",
        zip: null,
        lat: 32.1675,
        lng: 34.8578,
        geoSource: "address",
        distanceKm: 0.3,
      },
    ]);

    // Confirmed product_id for chain A's tomato — no equivalents yet (as resolve returns).
    const primary = cand({ productId: TOMATO_A, name: "עגבניות רשת א" });
    const resolved: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: 1,
      unit: "kg",
      productId: TOMATO_A,
      name: primary.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      confidence: 1,
      lowConfidence: false,
      candidates: [primary],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
    };

    resolveItems.mockResolvedValue([resolved]);

    // Simulate enrichCommodityCoverage attaching chain B's peer.
    enrichCommodityCoverage.mockImplementation(
      async (_items: unknown, items: ResolvedItem[]) => {
        const line = items[0]!;
        line.equivalents = [
          primary,
          cand({ productId: TOMATO_B, name: "עגבניות רשת ב", hasPrice: true, hasLocalPrice: true }),
        ];
      },
    );

    const byA = new Map<string, ListingRow[]>([
      [
        TOMATO_A,
        [
          {
            id: LISTING_A,
            product_id: TOMATO_A,
            chain_id: CHAIN_A,
            item_code: "A1",
            name: "עגבניות רשת א",
            gtin: null,
          },
        ],
      ],
    ]);
    const byB = new Map<string, ListingRow[]>([
      [
        TOMATO_B,
        [
          {
            id: LISTING_B,
            product_id: TOMATO_B,
            chain_id: CHAIN_B,
            item_code: "B1",
            name: "עגבניות רשת ב",
            gtin: null,
          },
        ],
      ],
    ]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [CHAIN_A, byA],
        [CHAIN_B, byB],
      ]),
      priceByListingAndStore: new Map<string, StorePriceRow>([
        [
          `${LISTING_A}:${STORE_A}`,
          {
            listing_id: LISTING_A,
            store_id: STORE_A,
            price: "8.9",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
        [
          `${LISTING_B}:${STORE_B}`,
          {
            listing_id: LISTING_B,
            store_id: STORE_B,
            price: "7.5",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });
  });

  it("product_id + query עגבניות still broadens and prices chain B via equivalent", async () => {
    const result = await optimizeBasket({
      city: "הרצליה",
      near: { lat: 32.1675, lng: 34.8578 },
      items: [{ productId: TOMATO_A, query: "עגבניות", amount: 1, unit: "kg" }],
      verbose: true,
      storesLimit: 0,
    }, OPTIONS);

    expect(enrichCommodityCoverage).toHaveBeenCalledOnce();
    const [itemsArg] = enrichCommodityCoverage.mock.calls[0]!;
    expect(itemsArg[0]).toMatchObject({ productId: TOMATO_A, query: "עגבניות" });

    const storeB = result.stores.find((s) => s.storeId === STORE_B);
    expect(storeB).toBeDefined();
    expect(storeB!.itemsFound).toBe(1);
    expect(storeB!.lines[0]!.productId).toBe(TOMATO_B);
    expect(storeB!.lines[0]!.substituted).toBe(true);
    expect(storeB!.missingItems).toHaveLength(0);

    // Nearer Neve Amal-style store should win bestSingleStore within the coverage band.
    if (result.status !== "complete") throw new Error("expected complete");
    expect(result.bestSingleStore?.storeId).toBe(STORE_B);
    expect(result.location.distanceReliable).toBe(true);
  });

  it("still invokes enrich for product_id-only (class stamp; peer pin is inside enrich)", async () => {
    // Peer broadening is skipped inside enrich when intent.mode === "exact";
    // optimize still calls enrich so missing class metadata can be stamped.
    enrichCommodityCoverage.mockImplementation(async () => {
      /* no equivalents attached — identity pin */
    });

    const result = await optimizeBasket({
      city: "הרצליה",
      near: { lat: 32.1675, lng: 34.8578 },
      items: [{ productId: TOMATO_A, amount: 1, unit: "kg" }],
      verbose: true,
      storesLimit: 0,
    }, OPTIONS);

    expect(enrichCommodityCoverage).toHaveBeenCalledOnce();
    const storeA = result.stores.find((s) => s.storeId === STORE_A);
    expect(storeA?.lines[0]?.productId).toBe(TOMATO_A);
    const storeB = result.stores.find((s) => s.storeId === STORE_B);
    // Without equivalents, chain B cannot price the confirmed tomato UUID.
    expect(storeB == null || storeB.itemsFound === 0 || storeB.missingItems.length > 0).toBe(true);
  });

  it("product_id-only Taster's Choice does not gain class peers or substitute cheaper coffee", async () => {
    const tasters = cand({
      productId: TASTERS,
      name: "נסקפה טייסטרס צ'ויס 200ג",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      sizeQty: 200,
      sizeUnit: "g",
      hasPrice: true,
      hasLocalPrice: true,
    });
    const turkish = cand({
      productId: TURKISH_COFFEE,
      name: "קפה טורקי עלית",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      sizeQty: 200,
      sizeUnit: "g",
      hasPrice: true,
      hasLocalPrice: true,
    });
    resolveItems.mockResolvedValue([
      {
        index: 0,
        qty: 1,
        qtyMode: "packs",
        amount: null,
        unit: null,
        productId: TASTERS,
        name: tasters.name,
        resolvedBy: "product_id",
        resolutionStatus: "resolved",
        confidence: 1,
        lowConfidence: false,
        candidates: [tasters],
        primaryProductId: null,
        primaryName: null,
        substitution: null,
      },
    ]);
    // Tempt the optimizer: if peers leaked through, chain B would pick cheaper coffee.
    enrichCommodityCoverage.mockImplementation(async (items: Array<{ query?: string }>, resolved: ResolvedItem[]) => {
      expect(items[0]).toMatchObject({ productId: TASTERS });
      expect(items[0]?.query).toBeUndefined();
      // Exact product_id-only must not attach class peers (enrich skips for exact intent).
      expect(resolved[0]?.equivalents).toBeUndefined();
    });
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN_A,
          new Map([
            [
              TASTERS,
              [
                {
                  id: LISTING_TASTERS,
                  product_id: TASTERS,
                  chain_id: CHAIN_A,
                  item_code: "T1",
                  name: tasters.name,
                  gtin: null,
                },
              ],
            ],
          ]),
        ],
        [
          CHAIN_B,
          new Map([
            [
              TURKISH_COFFEE,
              [
                {
                  id: LISTING_TURKISH,
                  product_id: TURKISH_COFFEE,
                  chain_id: CHAIN_B,
                  item_code: "T2",
                  name: turkish.name,
                  gtin: null,
                },
              ],
            ],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map<string, StorePriceRow>([
        [
          `${LISTING_TASTERS}:${STORE_A}`,
          {
            listing_id: LISTING_TASTERS,
            store_id: STORE_A,
            price: "32",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
        [
          `${LISTING_TURKISH}:${STORE_B}`,
          {
            listing_id: LISTING_TURKISH,
            store_id: STORE_B,
            price: "18",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket({
      city: "הרצליה",
      near: { lat: 32.1675, lng: 34.8578 },
      items: [{ productId: TASTERS, packQty: 1 }],
      verbose: true,
      storesLimit: 0,
    }, OPTIONS);

    expect(enrichCommodityCoverage).toHaveBeenCalledOnce();
    const storeA = result.stores.find((s) => s.storeId === STORE_A);
    expect(storeA?.lines[0]?.productId).toBe(TASTERS);
    expect(storeA?.lines[0]?.substituted).toBeFalsy();
    const storeB = result.stores.find((s) => s.storeId === STORE_B);
    expect(storeB == null || storeB.itemsFound === 0 || storeB.missingItems.length > 0).toBe(true);
    expect(result.stores.flatMap((s) => s.lines).some((l) => l.productId === TURKISH_COFFEE)).toBe(
      false,
    );
  });

  it("product_id-only Coke Zero does not gain class peers or substitute regular Coke", async () => {
    const cokeZero = cand({
      productId: COKE_ZERO,
      name: "קוקה קולה זירו 1.5 ל",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "soft_drink",
      classL3: "cola",
      variant: "diet_zero",
      sizeQty: 1500,
      sizeUnit: "ml",
      hasPrice: true,
      hasLocalPrice: true,
    });
    resolveItems.mockResolvedValue([
      {
        index: 0,
        qty: 1,
        qtyMode: "packs",
        amount: null,
        unit: null,
        productId: COKE_ZERO,
        name: cokeZero.name,
        resolvedBy: "product_id",
        resolutionStatus: "resolved",
        confidence: 1,
        lowConfidence: false,
        candidates: [cokeZero],
        primaryProductId: null,
        primaryName: null,
        substitution: null,
      },
    ]);
    enrichCommodityCoverage.mockImplementation(async (items: Array<{ query?: string }>, resolved: ResolvedItem[]) => {
      expect(items[0]).toMatchObject({ productId: COKE_ZERO });
      expect(items[0]?.query).toBeUndefined();
      expect(resolved[0]?.equivalents).toBeUndefined();
    });
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN_A,
          new Map([
            [
              COKE_ZERO,
              [
                {
                  id: LISTING_COKE_ZERO,
                  product_id: COKE_ZERO,
                  chain_id: CHAIN_A,
                  item_code: "C0",
                  name: cokeZero.name,
                  gtin: null,
                },
              ],
            ],
          ]),
        ],
        [
          CHAIN_B,
          new Map([
            [
              COKE_REGULAR,
              [
                {
                  id: LISTING_COKE_REG,
                  product_id: COKE_REGULAR,
                  chain_id: CHAIN_B,
                  item_code: "C1",
                  name: "קוקה קולה 1.5 ל",
                  gtin: null,
                },
              ],
            ],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map<string, StorePriceRow>([
        [
          `${LISTING_COKE_ZERO}:${STORE_A}`,
          {
            listing_id: LISTING_COKE_ZERO,
            store_id: STORE_A,
            price: "9.9",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
        [
          `${LISTING_COKE_REG}:${STORE_B}`,
          {
            listing_id: LISTING_COKE_REG,
            store_id: STORE_B,
            price: "7.5",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket({
      city: "הרצליה",
      near: { lat: 32.1675, lng: 34.8578 },
      items: [{ productId: COKE_ZERO, packQty: 1 }],
      verbose: true,
      storesLimit: 0,
    }, OPTIONS);

    expect(enrichCommodityCoverage).toHaveBeenCalledOnce();
    const storeA = result.stores.find((s) => s.storeId === STORE_A);
    expect(storeA?.lines[0]?.productId).toBe(COKE_ZERO);
    expect(storeA?.lines[0]?.substituted).toBeFalsy();
    expect(result.stores.flatMap((s) => s.lines).some((l) => l.productId === COKE_REGULAR)).toBe(
      false,
    );
  });

  it("GTIN-only request does not gain class peers or substitute another product", async () => {
    const primary = cand({
      productId: GTIN_PRODUCT,
      name: "חלב תנובה 3%",
      productClass: "dairy",
      classL1: "dairy",
      classL2: "milk",
      classL3: "fresh_milk",
      sizeQty: 1000,
      sizeUnit: "ml",
      hasPrice: true,
      hasLocalPrice: true,
    });
    const peer = cand({
      productId: GTIN_PEER,
      name: "חלב טרה 3%",
      productClass: "dairy",
      classL1: "dairy",
      classL2: "milk",
      classL3: "fresh_milk",
      sizeQty: 1000,
      sizeUnit: "ml",
      hasPrice: true,
      hasLocalPrice: true,
    });
    resolveItems.mockResolvedValue([
      {
        index: 0,
        qty: 1,
        qtyMode: "packs",
        amount: null,
        unit: null,
        productId: GTIN_PRODUCT,
        name: primary.name,
        resolvedBy: "gtin",
        resolutionStatus: "resolved",
        confidence: 1,
        lowConfidence: false,
        candidates: [primary],
        primaryProductId: null,
        primaryName: null,
        substitution: null,
      },
    ]);
    enrichCommodityCoverage.mockImplementation(
      async (items: Array<{ gtin?: string; query?: string }>, resolved: ResolvedItem[]) => {
        expect(items[0]).toMatchObject({ gtin: "7290004131074" });
        expect(items[0]?.query).toBeUndefined();
        expect(resolved[0]?.resolvedBy).toBe("gtin");
        expect(resolved[0]?.equivalents).toBeUndefined();
      },
    );
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          CHAIN_A,
          new Map([
            [
              GTIN_PRODUCT,
              [
                {
                  id: LISTING_GTIN,
                  product_id: GTIN_PRODUCT,
                  chain_id: CHAIN_A,
                  item_code: "G1",
                  name: primary.name,
                  gtin: "7290004131074",
                },
              ],
            ],
          ]),
        ],
        [
          CHAIN_B,
          new Map([
            [
              GTIN_PEER,
              [
                {
                  id: LISTING_GTIN_PEER,
                  product_id: GTIN_PEER,
                  chain_id: CHAIN_B,
                  item_code: "G2",
                  name: peer.name,
                  gtin: "7290004131999",
                },
              ],
            ],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map<string, StorePriceRow>([
        [
          `${LISTING_GTIN}:${STORE_A}`,
          {
            listing_id: LISTING_GTIN,
            store_id: STORE_A,
            price: "7.2",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
        [
          `${LISTING_GTIN_PEER}:${STORE_B}`,
          {
            listing_id: LISTING_GTIN_PEER,
            store_id: STORE_B,
            price: "5.9",
            currency: "ILS",
            source_ts: "2026-07-19T00:00:00Z",
            ingested_at: "2026-07-19T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket({
      city: "הרצליה",
      near: { lat: 32.1675, lng: 34.8578 },
      items: [{ gtin: "7290004131074", packQty: 1 }],
      verbose: true,
      storesLimit: 0,
    }, OPTIONS);

    expect(enrichCommodityCoverage).toHaveBeenCalledOnce();
    const storeA = result.stores.find((s) => s.storeId === STORE_A);
    expect(storeA?.lines[0]?.productId).toBe(GTIN_PRODUCT);
    expect(storeA?.lines[0]?.substituted).toBeFalsy();
    expect(result.stores.flatMap((s) => s.lines).some((l) => l.productId === GTIN_PEER)).toBe(false);
  });
});
