import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

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

// commodityCoverage → loadProductClasses hits Postgres; unit tests have no DATABASE_URL in CI.
vi.mock("../../../src/services/basket/productClasses.js", () => ({
  loadProductClasses: vi.fn(async () => new Map()),
}));

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

const OPTIONS = { continuationSecret: "test-only-basket-continuation-secret-ok" };
const STORE_ID = "11111111-1111-4111-8111-111111111111";

function makeCandidate(productId: string, name: string, score = 0.5) {
  return {
    productId,
    name,
    score,
    matchedVia: "product" as const,
    sizeQty: null,
    sizeUnit: null,
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: null,
  };
}

function makeResolvedItem(
  index: number,
  options: {
    resolved?: boolean;
    extraCandidates?: Array<{ productId: string; name: string }>;
  } = {},
): ResolvedItem {
  const resolved = options.resolved ?? false;
  const productId = resolved ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` : null;
  const primary = makeCandidate(
    productId ?? `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
    resolved ? `Product ${index}` : `Candidate ${index}`,
    resolved ? 0.95 : 0.5,
  );
  return {
    index,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId,
    name: primary.name,
    resolvedBy: resolved ? "query" : "unresolved",
    resolutionStatus: resolved ? "resolved" : "needs_confirmation",
    confidence: resolved ? 0.95 : null,
    lowConfidence: !resolved,
    candidates: [
      primary,
      ...(options.extraCandidates ?? []).map((c) => makeCandidate(c.productId, c.name)),
    ],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

describe("optimizeBasket pricing scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockResolvedValue(new Map());
    listStores.mockResolvedValue([
      {
        id: STORE_ID,
        chainId: "22222222-2222-4222-8222-222222222222",
        chainName: "Test Chain",
        storeCode: "1",
        name: "Test Store",
        address: null,
        city: "Herzliya",
        zip: null,
        lat: null,
        lng: null,
        geoSource: null,
        distanceKm: 1,
      },
    ]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map(),
      priceByListingAndStore: new Map(),
      promoMap: new Map(),
    });
  });

  it("does not call loadBasketPricingData when confirmation is required", async () => {
    resolveItems.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => makeResolvedItem(index, { resolved: false })),
    );

    const result = await optimizeBasket(
      {
        items: [
          { query: "item 0", packQty: 1 },
          { query: "item 1", packQty: 1 },
          { query: "item 2", packQty: 1 },
        ],
        city: "Herzliya",
        resolutionMode: "strict",
        responseDetail: "summary",
      },
      OPTIONS,
    );

    expect(result.status).toBe("needs_confirmation");
    expect(loadBasketPricingData).not.toHaveBeenCalled();
  });

  it("passes only safely resolved product IDs to loadBasketPricingData when complete", async () => {
    const resolvedProductId = "00000000-0000-4000-8000-000000000000";
    resolveItems.mockResolvedValue([
      makeResolvedItem(0, {
        resolved: true,
        extraCandidates: [
          { productId: "00000000-0000-4000-9000-000000000001", name: "Alt cola 1" },
        ],
      }),
    ]);

    const result = await optimizeBasket(
      {
        items: [{ query: "cola", packQty: 1 }],
        city: "Herzliya",
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    expect(loadBasketPricingData).toHaveBeenCalledOnce();
    expect(loadBasketPricingData).toHaveBeenCalledWith([resolvedProductId], [STORE_ID], true);
  });

  it("rejects known far branches from a 3km near scope and multiStore recommendations", async () => {
    const localId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const talpiotId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const beerYaakovId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const chainId = "22222222-2222-4222-8222-222222222222";
    const productId = "00000000-0000-4000-8000-000000000000";
    const listingId = "listing-local";

    const allowedStoreIds = new Set([localId]);

    listStores.mockResolvedValue([
      {
        id: localId,
        chainId,
        chainName: "Test Chain",
        storeCode: "1",
        name: "Dizengoff",
        address: "דיזנגוף 1",
        city: "תל אביב",
        zip: null,
        lat: 32.08,
        lng: 34.775,
        geoSource: "address",
        distanceKm: 0.8,
      },
      {
        id: talpiotId,
        chainId,
        chainName: "Test Chain",
        storeCode: "2",
        name: "תלפיות",
        address: "תלפיות",
        city: "ירושלים",
        zip: null,
        lat: 31.75,
        lng: 35.21,
        geoSource: "address",
        distanceKm: 55,
      },
      {
        id: beerYaakovId,
        chainId,
        chainName: "Test Chain",
        storeCode: "3",
        name: "באר יעקב",
        address: "באר יעקב",
        city: "באר יעקב",
        zip: null,
        lat: 31.94,
        lng: 34.84,
        geoSource: "address",
        distanceKm: 18,
      },
    ]);

    resolveItems.mockResolvedValue([makeResolvedItem(0, { resolved: true })]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          chainId,
          new Map([
            [
              productId,
              [
                {
                  id: listingId,
                  product_id: productId,
                  chain_id: chainId,
                  item_code: "1",
                  name: "Product 0",
                  gtin: null,
                },
              ],
            ],
          ]),
        ],
      ]),
      priceByListingAndStore: new Map([
        [
          `${listingId}:${localId}`,
          {
            listing_id: listingId,
            store_id: localId,
            price: "10",
            currency: "ILS",
            source_ts: "2026-07-21T00:00:00Z",
            ingested_at: "2026-07-21T00:00:00Z",
          },
        ],
        [
          `${listingId}:${talpiotId}`,
          {
            listing_id: listingId,
            store_id: talpiotId,
            price: "1",
            currency: "ILS",
            source_ts: "2026-07-21T00:00:00Z",
            ingested_at: "2026-07-21T00:00:00Z",
          },
        ],
        [
          `${listingId}:${beerYaakovId}`,
          {
            listing_id: listingId,
            store_id: beerYaakovId,
            price: "2",
            currency: "ILS",
            source_ts: "2026-07-21T00:00:00Z",
            ingested_at: "2026-07-21T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });

    const result = await optimizeBasket(
      {
        items: [{ query: "cola", packQty: 1 }],
        near: { lat: 32.0819, lng: 34.7712 },
        radiusKm: 3,
        responseDetail: "standard",
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected complete");
    expect(result.multiStore?.lines.every((line) => allowedStoreIds.has(line.storeId))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("תלפיות");
    expect(JSON.stringify(result)).not.toContain("באר יעקב");
    expect(result.bestSingleStore?.storeId).toBe(localId);
    expect(result.bestSingleStore?.totalScope).toBe("complete_basket");
  });
});
