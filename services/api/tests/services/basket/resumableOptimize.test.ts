import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

// One-call fast staples regression (default path): see fastBasketGolden.test.ts
// and fixtures/telAvivStaplesBasket.ts. This suite remains the strict/resume contract.

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
import { clearResolutionCache } from "../../../src/services/basket/resolutionCache.js";

const SECRET = "test-only-basket-continuation-secret-ok";
const OPTIONS = { continuationSecret: SECRET, now: 1_000 };
const STORE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_SAFE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LISTING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const STRICT = { resolutionMode: "strict" as const, responseDetail: "summary" as const };
const FAST = { resolutionMode: "fast" as const, responseDetail: "summary" as const };

function candidate(productId: string, name: string, score = 0.9) {
  return {
    productId,
    name,
    score,
    matchedVia: "product" as const,
    sizeQty: 1,
    sizeUnit: "unit",
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "bakery",
    classL1: "bakery",
    intentTier: 1 as const,
  };
}

function resolvedSafe(): ResolvedItem {
  const primary = candidate(PRODUCT_SAFE, "מלח גס");
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: PRODUCT_SAFE,
    name: primary.name,
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 0.95,
    lowConfidence: false,
    candidates: [primary],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

function resolvedAmbiguous(): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: null,
    name: "פיתות",
    resolvedBy: "query",
    resolutionStatus: "needs_confirmation",
    confidence: null,
    lowConfidence: true,
    candidates: [
      candidate(PRODUCT_A, "פיתות 10", 0.9),
      candidate(PRODUCT_B, "פיתות 8", 0.85),
    ],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

describe("resumable optimizeBasket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearResolutionCache();
    listStores.mockResolvedValue([
      {
        id: STORE_ID,
        chainId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        chainName: "Test",
        storeCode: "1",
        name: "Test Store",
        address: "Addr",
        city: "הרצליה",
        zip: null,
        lat: 32.16,
        lng: 34.84,
        geoSource: "address",
        distanceKm: 1,
      },
    ]);
    loadCandidateAvailability.mockResolvedValue(
      new Map([
        [PRODUCT_A, { pricedStoreCount: 4, chainCount: 2, minPrice: 10 }],
        [PRODUCT_B, { pricedStoreCount: 2, chainCount: 1, minPrice: 9 }],
        [PRODUCT_SAFE, { pricedStoreCount: 3, chainCount: 2, minPrice: 5 }],
      ]),
    );
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          new Map([
            [
              PRODUCT_SAFE,
              [
                {
                  id: LISTING_ID,
                  product_id: PRODUCT_SAFE,
                  chain_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  item_code: "1",
                  name: "מלח גס",
                  gtin: null,
                },
              ],
            ],
            [
              PRODUCT_A,
              [
                {
                  id: LISTING_ID,
                  product_id: PRODUCT_A,
                  chain_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  item_code: "2",
                  name: "פיתות 10",
                  gtin: null,
                  piece_count: 10,
                },
              ],
            ],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map([
        [
          `${LISTING_ID}:${STORE_ID}`,
          {
            listing_id: LISTING_ID,
            store_id: STORE_ID,
            price: "12",
            currency: "ILS",
            source_ts: "2026-07-20T00:00:00Z",
            ingested_at: "2026-07-20T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });
    enrichCommodityCoverage.mockResolvedValue(undefined);
  });

  it("returns complete in one call when no required questions remain", async () => {
    resolveItems.mockResolvedValue([resolvedSafe()]);
    const result = await optimizeBasket(
      { city: "הרצליה", items: [{ query: "מלח גס", packQty: 1 }], ...STRICT },
      OPTIONS,
    );
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    expect(result.bestSingleStore).not.toBeNull();
    expect(loadBasketPricingData).toHaveBeenCalledOnce();
  });

  it("returns continuation and no final recommendations when confirmation is required", async () => {
    resolveItems.mockResolvedValue([resolvedAmbiguous()]);
    const result = await optimizeBasket(
      { city: "הרצליה", items: [{ query: "פיתות", amount: 20, unit: "יח" }], ...STRICT },
      OPTIONS,
    );
    expect(result.status).toBe("needs_confirmation");
    if (result.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(result).not.toHaveProperty("bestSingleStore");
    expect(result).not.toHaveProperty("multiStore");
    expect(result.questions[0]?.options[0]?.nearbyPricedStores).toBeGreaterThan(0);
    expect(loadBasketPricingData).not.toHaveBeenCalled();
    expect(enrichCommodityCoverage).not.toHaveBeenCalled();
  });

  it("keeps recommended-store lines for responseDetail standard (not summary-only trim)", async () => {
    resolveItems.mockResolvedValue([resolvedSafe()]);
    const standard = await optimizeBasket(
      {
        city: "הרצליה",
        items: [{ query: "מלח גס", packQty: 1 }],
        resolutionMode: "fast",
        responseDetail: "standard",
      },
      OPTIONS,
    );
    expect(standard.status).toBe("complete");
    if (standard.status !== "complete") throw new Error("expected complete");
    expect(standard.bestSingleStore?.lines.length).toBeGreaterThan(0);

    const summary = await optimizeBasket(
      {
        city: "הרצליה",
        items: [{ query: "מלח גס", packQty: 1 }],
        ...FAST,
      },
      OPTIONS,
    );
    expect(summary.status).toBe("complete");
    if (summary.status !== "complete") throw new Error("expected complete");
    // summary may clear multiStore lines; standard must not force-clear them.
    if (standard.multiStore) {
      expect(standard.multiStore.lines.length).toBeGreaterThan(0);
    }
    if (summary.multiStore && standard.multiStore) {
      expect(summary.multiStore.lines.length).toBe(0);
      expect(standard.multiStore.lines.length).toBeGreaterThan(0);
    }
  });

  it("separates fast completion from strict confirmation on the same ambiguous input", async () => {
    const input = {
      city: "הרצליה",
      items: [{ query: "פיתות", amount: 20, unit: "יח" }],
    };
    resolveItems.mockResolvedValue([resolvedAmbiguous()]);

    const fast = await optimizeBasket({ ...input, ...FAST }, OPTIONS);
    expect(fast.status).toBe("complete");
    if (fast.status !== "complete") throw new Error("expected complete");
    expect(fast.assumptions.some((a) => a.itemIndex === 0)).toBe(true);
    expect(fast).not.toHaveProperty("continuation");
    expect(loadBasketPricingData).toHaveBeenCalled();

    vi.clearAllMocks();
    clearResolutionCache();
    listStores.mockResolvedValue([
      {
        id: STORE_ID,
        chainId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        chainName: "Test",
        storeCode: "1",
        name: "Test Store",
        address: "Addr",
        city: "הרצליה",
        zip: null,
        lat: 32.16,
        lng: 34.84,
        geoSource: "address",
        distanceKm: 1,
      },
    ]);
    loadCandidateAvailability.mockResolvedValue(
      new Map([
        [PRODUCT_A, { pricedStoreCount: 4, chainCount: 2, minPrice: 10 }],
        [PRODUCT_B, { pricedStoreCount: 2, chainCount: 1, minPrice: 9 }],
      ]),
    );
    resolveItems.mockResolvedValue([resolvedAmbiguous()]);

    const strict = await optimizeBasket({ ...input, ...STRICT }, OPTIONS);
    expect(strict.status).toBe("needs_confirmation");
    if (strict.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(loadBasketPricingData).not.toHaveBeenCalled();
  });

  it("resumes using only continuation and answers", async () => {
    resolveItems
      .mockResolvedValueOnce([resolvedAmbiguous()])
      .mockResolvedValueOnce([
        {
          ...resolvedSafe(),
          productId: PRODUCT_A,
          name: "פיתות 10",
          candidates: [candidate(PRODUCT_A, "פיתות 10")],
        },
      ]);

    const first = await optimizeBasket(
      { city: "הרצליה", items: [{ query: "פיתות", amount: 20, unit: "יח" }], ...STRICT },
      OPTIONS,
    );
    if (first.status !== "needs_confirmation") throw new Error("expected confirmation");

    const second = await optimizeBasket(
      {
        continuation: first.continuation,
        answers: [
          {
            itemIndex: 0,
            productId: first.questions[0]!.options[0]!.productId,
          },
        ],
      },
      OPTIONS,
    );
    expect(second.status).toBe("complete");
    expect(resolveItems).toHaveBeenCalledTimes(2);
    const resumedItems = resolveItems.mock.calls[1]![0] as Array<{
      productId?: string;
      query?: string;
      intentModeOverride?: string;
    }>;
    expect(resumedItems[0]).toMatchObject({
      productId: PRODUCT_A,
      query: "פיתות",
      intentModeOverride: "commodity",
    });
  });

  it("rejects resume answers outside the allowed product IDs", async () => {
    resolveItems.mockResolvedValue([resolvedAmbiguous()]);
    const first = await optimizeBasket(
      { city: "הרצליה", items: [{ query: "פיתות", amount: 20, unit: "יח" }], ...STRICT },
      OPTIONS,
    );
    if (first.status !== "needs_confirmation") throw new Error("expected confirmation");

    await expect(
      optimizeBasket(
        {
          continuation: first.continuation,
          answers: [{ itemIndex: 0, productId: PRODUCT_SAFE }],
        },
        OPTIONS,
      ),
    ).rejects.toThrow(/allowed|product/i);
  });

  it("reuses the cached resolution for non-answered lines by original index", async () => {
    const ambiguousAt0 = { ...resolvedAmbiguous(), index: 0 };
    const safeAt1 = { ...resolvedSafe(), index: 1 };
    resolveItems
      .mockResolvedValueOnce([ambiguousAt0, safeAt1])
      .mockResolvedValueOnce([
        {
          ...resolvedSafe(),
          index: 0,
          productId: PRODUCT_A,
          name: "פיתות 10",
          candidates: [candidate(PRODUCT_A, "פיתות 10")],
        },
        safeAt1,
      ]);

    const first = await optimizeBasket(
      {
        city: "הרצליה",
        items: [
          { query: "פיתות", amount: 20, unit: "יח" },
          { query: "מלח גס", packQty: 1 },
        ],
        ...STRICT,
      },
      OPTIONS,
    );
    if (first.status !== "needs_confirmation") throw new Error("expected confirmation");

    await optimizeBasket(
      {
        continuation: first.continuation,
        answers: [{ itemIndex: 0, productId: first.questions[0]!.options[0]!.productId }],
      },
      OPTIONS,
    );

    // The resume must hand resolveItems a reuse map that carries ONLY the
    // non-answered line (index 1), keyed by its original index, so the answered
    // line (index 0) is re-resolved and the safe line is reused verbatim.
    const reuse = resolveItems.mock.calls[1]![2] as
      | Map<number, { index: number; productId: string | null }>
      | undefined;
    expect(reuse).toBeInstanceOf(Map);
    expect(reuse!.has(0)).toBe(false);
    expect(reuse!.has(1)).toBe(true);
    expect(reuse!.get(1)).toMatchObject({ index: 1, productId: PRODUCT_SAFE });
  });
});
