import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

const resolveItems = vi.fn();
const listStores = vi.fn();
const loadBasketPricingData = vi.fn();
const loadCandidateAvailability = vi.fn();

vi.mock("../../../src/services/basket/resolve.js", () => ({
  resolveItems: (...args: unknown[]) => resolveItems(...args),
}));

// commodityCoverage → loadProductClasses hits Postgres; unit tests have no DATABASE_URL in CI.
vi.mock("../../../src/services/basket/productClasses.js", () => ({
  loadProductClasses: vi.fn(async () => new Map()),
}));

vi.mock("../../../src/services/stores/index.js", () => ({
  listStores: (...args: unknown[]) => listStores(...args),
}));

vi.mock("../../../src/services/basket/loadPricingData.js", () => ({
  loadBasketPricingData: (...args: unknown[]) => loadBasketPricingData(...args),
  loadCandidateAvailability: (...args: unknown[]) => loadCandidateAvailability(...args),
}));

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

const OPTIONS = { continuationSecret: "test-only-basket-continuation-secret-ok" };

function makeResolvedItem(index: number, resolved: boolean): ResolvedItem {
  const productId = resolved ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` : null;
  return {
    index,
    qty: 1,
    qtyMode: "packs",
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

describe("optimizeBasket confirmation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockResolvedValue(new Map());
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
        geoSource: null,
        distanceKm: 1,
      },
    ]);
    resolveItems.mockResolvedValue(
      Array.from({ length: 18 }, (_, index) => makeResolvedItem(index, index === 0)),
    );
  });

  it("returns needs_confirmation without pricing when required questions remain", async () => {
    const result = await optimizeBasket(
      {
        items: Array.from({ length: 18 }, (_, index) => ({ query: `item ${index}`, packQty: 1 })),
        city: "הרצליה",
      },
      OPTIONS,
    );

    expect(result.status).toBe("needs_confirmation");
    if (result.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(result.preview.resolvedLines).toBe(1);
    expect(result.preview.requestedLines).toBe(18);
    expect(result.questions.length).toBe(17);
    expect(result).not.toHaveProperty("bestSingleStore");
    expect(loadBasketPricingData).not.toHaveBeenCalled();
    expect(result.continuation.length).toBeGreaterThan(10);
  });
});
