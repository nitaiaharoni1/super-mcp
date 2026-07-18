import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

const resolveItems = vi.fn();
const listStores = vi.fn();
const loadBasketPricingData = vi.fn();

vi.mock("../../../src/services/basket/resolve.js", () => ({
  resolveItems: (...args: unknown[]) => resolveItems(...args),
}));

vi.mock("../../../src/services/stores/index.js", () => ({
  listStores: (...args: unknown[]) => listStores(...args),
}));

vi.mock("../../../src/services/basket/loadPricingData.js", () => ({
  loadBasketPricingData: (...args: unknown[]) => loadBasketPricingData(...args),
}));

vi.mock("../../../src/services/search/ontology.js", () => ({
  getActiveOntology: vi.fn().mockResolvedValue(null),
}));

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

function makeResolvedItem(index: number, resolved: boolean): ResolvedItem {
  const productId = resolved ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` : null;
  return {
    index,
    qty: 1,
    qtyMode: "legacy_packs",
    amount: null,
    unit: null,
    productId,
    name: resolved ? `Product ${index}` : `Query ${index}`,
    resolvedBy: resolved ? "query" : "unresolved",
    resolutionStatus: resolved ? "resolved" : "needs_confirmation",
    confidence: resolved ? 0.95 : null,
    lowConfidence: !resolved,
    candidates: [
      {
        productId: productId ?? `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
        name: resolved ? `Product ${index}` : `Candidate ${index}`,
        score: resolved ? 0.95 : 0.5,
        matchedVia: "product",
        sizeQty: null,
        sizeUnit: null,
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

describe("optimizeBasket completeness gate", () => {
  beforeEach(() => {
    listStores.mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        chainId: "22222222-2222-4222-8222-222222222222",
        chainName: "Test Chain",
        storeCode: "1",
        name: "Test Store",
        address: null,
        city: "הרצליה",
        zip: null,
        lat: null,
        lng: null,
        distanceKm: 1,
      },
    ]);
    resolveItems.mockResolvedValue(
      Array.from({ length: 18 }, (_, index) => makeResolvedItem(index, index === 0)),
    );
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map([
        [
          "22222222-2222-4222-8222-222222222222",
          new Map([
            [
              "00000000-0000-4000-8000-000000000000",
              [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  product_id: "00000000-0000-4000-8000-000000000000",
                  chain_id: "22222222-2222-4222-8222-222222222222",
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
          "33333333-3333-4333-8333-333333333333:11111111-1111-4111-8111-111111111111",
          {
            listing_id: "33333333-3333-4333-8333-333333333333",
            store_id: "11111111-1111-4111-8111-111111111111",
            price: "10",
            currency: "ILS",
            source_ts: "2026-01-01T00:00:00Z",
            ingested_at: "2026-01-01T00:00:00Z",
          },
        ],
      ]),
      promoMap: new Map(),
    });
  });

  it("prices the resolved subset and returns questions inline on a partial basket", async () => {
    const result = await optimizeBasket({
      items: Array.from({ length: 18 }, (_, index) => ({ query: `item ${index}`, qty: 1 })),
      city: "הרצליה",
    });

    // The wasted-response bug: totals were nulled when partial. Now the safely
    // resolved subset is always priced, so a recommendation exists.
    expect(result.cheapest).not.toBeNull();
    expect(result.multiStore).not.toBeNull();
    // Still honestly flagged: only 1/18 lines resolved.
    expect(result.completeness.totalsArePartial).toBe(true);
    expect(result.completeness.requestedLines).toBe(18);
    expect(result.completeness.resolvedLines).toBe(1);
    expect(result.completeness.needsConfirmationLines).toBe(17);
    expect(result.completeness.unresolvedLines).toBe(0);
    expect(result.completeness.safeResolutionRatio).toBeCloseTo(1 / 18);
    // One question per unconfirmed line, built with the exact prepare shape.
    expect(result.questions).toHaveLength(17);
    for (const q of result.questions) {
      expect(q).toMatchObject({
        itemIndex: expect.any(Number),
        id: expect.stringContaining("product"),
        prompt: expect.any(String),
        reason: expect.any(String),
        required: true,
      });
      expect(Array.isArray(q.options)).toBe(true);
    }
    expect(result.items).toHaveLength(18);
    expect(result.stores.length).toBeGreaterThan(0);
    expect(loadBasketPricingData).toHaveBeenCalledOnce();
    expect(loadBasketPricingData).toHaveBeenCalledWith(
      ["00000000-0000-4000-8000-000000000000"],
      ["11111111-1111-4111-8111-111111111111"],
      true,
    );
  });
});
