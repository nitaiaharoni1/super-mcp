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
        productId: resolved
          ? productId(index)
          : `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
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

describe("optimizeBasket response_detail projection", () => {
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

  const baseInput = {
    items: Array.from({ length: LINE_COUNT }, (_, index) => ({
      query: `item ${index}`,
      packQty: 1,
    })),
    city: "הרצליה",
    resolutionMode: "fast" as const,
  };

  it("summary omits stores and item candidates under the 15KB budget", async () => {
    const summary = await optimizeBasket(
      { ...baseInput, responseDetail: "summary" },
      OPTIONS,
    );

    expect(summary.status).toBe("complete");
    expect(summary).not.toHaveProperty("stores");
    expect(summary.items.every((item) => !("candidates" in item))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(summary), "utf8")).toBeLessThan(15_000);

    if (summary.status !== "complete") throw new Error("expected complete");
    expect(summary.coverage).toMatchObject({
      requestedLines: LINE_COUNT,
      pricedLines: expect.any(Number),
      omittedLines: expect.any(Number),
    });
    expect(Array.isArray(summary.assumptions)).toBe(true);
    expect(Array.isArray(summary.omittedItems)).toBe(true);
    expect(summary.bestSingleStore?.lines.some((line) => "link" in line)).toBe(true);
  });

  it("debug keeps stores, candidates, and phase timings", async () => {
    const debug = await optimizeBasket({ ...baseInput, responseDetail: "debug" }, OPTIONS);
    expect(debug.status).toBe("complete");
    if (debug.status !== "complete") throw new Error("expected complete");
    expect(debug.stores!.length).toBeGreaterThan(0);
    expect(debug.items.some((item) => "candidates" in item && item.candidates.length > 0)).toBe(
      true,
    );
    expect(debug.timings).toMatchObject({
      searchMs: expect.any(Number),
      pricingMs: expect.any(Number),
    });
  });

  it("standard keeps item statuses and recommended-store lines without full debug stores", async () => {
    const standard = await optimizeBasket(
      { ...baseInput, responseDetail: "standard" },
      OPTIONS,
    );
    expect(standard.status).toBe("complete");
    if (standard.status !== "complete") throw new Error("expected complete");
    expect(standard.bestSingleStore?.lines.length).toBeGreaterThan(0);
    expect(standard.items.length).toBe(LINE_COUNT);
    expect(standard.items.every((item) => Array.isArray(item.candidates))).toBe(true);
    expect(standard.items.every((item) => item.candidates.length === 0)).toBe(true);
    // Standard may include trimmed stores for recommended coverage, but not require timings.
    expect(standard).not.toHaveProperty("timings");
  });

  it("verbose true maps to debug when responseDetail is absent", async () => {
    const result = await optimizeBasket({ ...baseInput, verbose: true }, OPTIONS);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    expect(result.stores!.length).toBeGreaterThan(0);
    expect(result.items.some((item) => item.candidates.length > 0)).toBe(true);
  });

  it("responseDetail summary wins over verbose true", async () => {
    const summary = await optimizeBasket(
      { ...baseInput, responseDetail: "summary", verbose: true },
      OPTIONS,
    );
    expect(summary.status).toBe("complete");
    expect(summary).not.toHaveProperty("stores");
  });

  it("strict needs_confirmation summary stays compact without item candidates", async () => {
    resolveItems.mockResolvedValue(
      Array.from({ length: LINE_COUNT }, (_, index) => ({
        ...makeResolvedItem(index),
        productId: null,
        resolutionStatus: "needs_confirmation" as const,
        lowConfidence: true,
        confidence: null,
      })),
    );
    loadCandidateAvailability.mockImplementation(async (productIds: string[]) => {
      const map = new Map();
      for (const id of productIds) {
        map.set(id, { pricedStoreCount: 3, chainCount: 1, minPrice: 10 });
      }
      return map;
    });

    const result = await optimizeBasket(
      { ...baseInput, resolutionMode: "strict", responseDetail: "summary" },
      OPTIONS,
    );
    expect(result.status).toBe("needs_confirmation");
    if (result.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(result).not.toHaveProperty("items");
    expect(result.nextStep).toEqual({
      tool: "optimize_basket",
      useOnly: ["continuation", "answers"],
      doNotCall: ["search_products", "resolve_products", "compare_prices"],
    });
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.preview.requestedLines).toBe(LINE_COUNT);
  });

  it("does not duplicate identical store plans and caps summary at two plans", async () => {
    const summary = await optimizeBasket(
      { ...baseInput, responseDetail: "summary" },
      OPTIONS,
    );
    expect(summary.status).toBe("complete");
    if (summary.status !== "complete") throw new Error("expected complete");

    if (
      summary.bestSingleStore &&
      summary.cheapestCompleteStore &&
      summary.bestSingleStore.storeId === summary.cheapestCompleteStore.storeId
    ) {
      throw new Error("identical store plans must not both be present");
    }

    const planCount = [
      summary.bestSingleStore,
      summary.cheapestCompleteStore,
      summary.multiStore,
    ].filter(Boolean).length;
    expect(planCount).toBeLessThanOrEqual(2);
  });
});
