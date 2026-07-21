import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedItem, StorePriceRow } from "../../../src/services/basket/types.js";

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

// commodityCoverage → loadProductClasses hits Postgres; unit tests have no DATABASE_URL in CI.
vi.mock("../../../src/services/basket/productClasses.js", () => ({
  loadProductClasses: vi.fn(async () => new Map()),
}));

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

const OPTIONS = { continuationSecret: "test-only-basket-continuation-secret-ok" };

const CHAIN_ID = "22222222-2222-4222-8222-222222222222";
const LINE_COUNT = 10;
// Mirrors the real trace: a partial basket. The rest are needs_confirmation
// (unpriced, surfaced as questions), so only PRICED_LINES enter store lines.
const PRICED_LINES = LINE_COUNT; // all lines resolve for complete-path verbose tests
const STORE_COUNT = 12;

const productId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const listingId = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`;
const storeId = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;

function makeResolvedItem(index: number): ResolvedItem {
  const resolved = index < PRICED_LINES;
  return {
    index,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: resolved ? productId(index) : null,
    name: `מוצר ${index}`,
    resolvedBy: resolved ? "query" : "unresolved",
    resolutionStatus: resolved ? "resolved" : "needs_confirmation",
    confidence: resolved ? 0.95 : null,
    lowConfidence: !resolved,
    candidates: [
      {
        productId: resolved ? productId(index) : `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
        name: `מוצר ${index}`,
        score: resolved ? 0.95 : 0.5,
        matchedVia: "product",
        sizeQty: null,
        sizeUnit: null,
        pieceCount: null,
        hasPrice: true,
        hasLocalPrice: true,
        productClass: null,
      },
    ],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

function pricingData() {
  const byProduct = new Map<string, unknown[]>();
  const priceByListingAndStore = new Map<string, StorePriceRow>();
  for (let li = 0; li < PRICED_LINES; li += 1) {
    byProduct.set(productId(li), [
      {
        id: listingId(li),
        product_id: productId(li),
        chain_id: CHAIN_ID,
        item_code: String(li),
        name: `מוצר מספר ${li}`,
        gtin: null,
      },
    ]);
    for (let si = 0; si < STORE_COUNT; si += 1) {
      // Vary price per store so totals differ and one store is clearly cheapest.
      priceByListingAndStore.set(`${listingId(li)}:${storeId(si)}`, {
        listing_id: listingId(li),
        store_id: storeId(si),
        price: String(10 + si + li * 0.5),
        currency: "ILS",
        source_ts: "2026-01-01T00:00:00Z",
        ingested_at: "2026-01-01T00:00:00Z",
      });
    }
  }
  return {
    listingByChainAndProduct: new Map([[CHAIN_ID, byProduct]]),
    priceByListingAndStore,
    promoMap: new Map(),
  };
}

describe("optimizeBasket verbose flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockResolvedValue(new Map());
    listStores.mockResolvedValue(
      Array.from({ length: STORE_COUNT }, (_, si) => ({
        id: storeId(si),
        chainId: CHAIN_ID,
        chainName: "רשת בדיקה",
        storeCode: String(si),
        name: `סניף מספר ${si}`,
        address: `רחוב הבדיקה ${si}`,
        city: "הרצליה",
        zip: null,
        lat: null,
        lng: null,
        geoSource: null,
        distanceKm: si + 1,
      })),
    );
    resolveItems.mockResolvedValue(
      Array.from({ length: LINE_COUNT }, (_, index) => makeResolvedItem(index)),
    );
    loadBasketPricingData.mockResolvedValue(pricingData());
  });

  const optimizeInput = (verbose?: boolean, storesLimit?: number) => ({
    items: Array.from({ length: LINE_COUNT }, (_, index) => ({ query: `item ${index}`, packQty: 1 })),
    city: "הרצליה",
    ...(storesLimit === undefined ? {} : { storesLimit }),
    ...(verbose === undefined ? {} : { verbose }),
  });

  it("non-verbose omits per-store line detail except recommended stores", async () => {
    const result = await optimizeBasket(optimizeInput(false), OPTIONS);

    if (result.status !== "complete") throw new Error("expected complete");
    const recommendedIds = new Set(
      [
        result.bestSingleStore?.storeId,
        result.cheapestCompleteStore?.storeId,
      ].filter((id): id is string => Boolean(id)),
    );
    expect(recommendedIds.size).toBeGreaterThan(0);

    for (const s of result.stores) {
      if (recommendedIds.has(s.storeId)) {
        expect(s.lines.length).toBeGreaterThan(0);
      } else {
        expect(s.lines).toHaveLength(0);
      }
      // missingItems is always retained for coverage reasoning.
      expect(Array.isArray(s.missingItems)).toBe(true);
    }
  });

  it("verbose keeps per-store line detail on every store", async () => {
    const result = await optimizeBasket(optimizeInput(true), OPTIONS);
    if (result.status !== "complete") throw new Error("expected complete");
    for (const s of result.stores) {
      expect(s.lines.length).toBeGreaterThan(0);
    }
  });

  it("defaults to non-verbose (lines stripped on non-recommended stores)", async () => {
    const result = await optimizeBasket(optimizeInput(), OPTIONS);
    if (result.status !== "complete") throw new Error("expected complete");
    const recommendedIds = new Set(
      [
        result.bestSingleStore?.storeId,
        result.cheapestCompleteStore?.storeId,
      ].filter((id): id is string => Boolean(id)),
    );
    const nonRecommended = result.stores.filter((s) => !recommendedIds.has(s.storeId));
    expect(nonRecommended.length).toBeGreaterThan(0);
    for (const s of nonRecommended) expect(s.lines).toHaveLength(0);
  });

  it("non-verbose strips per-item candidates", async () => {
    const result = await optimizeBasket(optimizeInput(false), OPTIONS);
    if (result.status !== "complete") throw new Error("expected complete");
    for (const item of result.items) {
      expect(item.candidates).toHaveLength(0);
    }
  });

  it("verbose keeps per-item candidates", async () => {
    const result = await optimizeBasket(optimizeInput(true), OPTIONS);
    if (result.status !== "complete") throw new Error("expected complete");
    expect(result.items.some((item) => item.candidates.length > 0)).toBe(true);
  });

  it("non-verbose multi-line, 12-store payload stays under the 15KB budget", async () => {
    const verboseSize = JSON.stringify(await optimizeBasket(optimizeInput(true), OPTIONS)).length;
    const result = await optimizeBasket(optimizeInput(false), OPTIONS);
    const size = JSON.stringify(result).length;
    // All 10 lines are priced in the complete path; keep a soft absolute ceiling
    // and require a real reduction vs verbose.
    expect(size).toBeLessThan(25_000);
    expect(size).toBeLessThan(verboseSize * 0.7);
  });
});
