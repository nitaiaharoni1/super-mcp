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
const LISTING_A = "d4444444-4444-4444-8444-000000000001";
const LISTING_B = "e4444444-4444-4444-8444-000000000001";

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
});
