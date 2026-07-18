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

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const CHAIN_ID = "22222222-2222-4222-8222-222222222222";

function makeCandidate(productId: string, name: string, score = 0.5) {
  return {
    productId,
    name,
    score,
    matchedVia: "product" as const,
    sizeQty: null,
    sizeUnit: null,
    hasPrice: true,
    hasLocalPrice: true,
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
  const productId = resolved
    ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    : null;
  const shortlistCandidates = options.extraCandidates?.map((c) => makeCandidate(c.productId, c.name)) ?? [];
  const defaultCandidate = makeCandidate(
    productId ?? `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
    resolved ? `Product ${index}` : `Candidate ${index}`,
    resolved ? 0.95 : 0.5,
  );

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
    candidates: [defaultCandidate, ...shortlistCandidates],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

describe("optimizeBasket pricing scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStores.mockResolvedValue([
      {
        id: STORE_ID,
        chainId: CHAIN_ID,
        chainName: "Test Chain",
        storeCode: "1",
        name: "Test Store",
        address: null,
        city: "Herzliya",
        zip: null,
        lat: null,
        lng: null,
        distanceKm: 1,
      },
    ]);
    loadBasketPricingData.mockResolvedValue({
      listingByChainAndProduct: new Map(),
      priceByListingAndStore: new Map(),
      promoMap: new Map(),
    });
  });

  it("does not call loadBasketPricingData when zero lines are safely resolved", async () => {
    resolveItems.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => makeResolvedItem(index, { resolved: false })),
    );

    const result = await optimizeBasket({
      items: [
        { query: "item 0", qty: 1 },
        { query: "item 1", qty: 1 },
        { query: "item 2", qty: 1 },
      ],
      city: "Herzliya",
    });

    expect(loadBasketPricingData).not.toHaveBeenCalled();
    expect(result.stores).toEqual([]);
    expect(result.cheapest).toBeNull();
    expect(result.completeness.resolvedLines).toBe(0);
    expect(result.completeness.totalsArePartial).toBe(true);
  });

  it("passes only safely resolved product IDs to loadBasketPricingData", async () => {
    const resolvedProductId = "00000000-0000-4000-8000-000000000000";
    resolveItems.mockResolvedValue([
      makeResolvedItem(0, {
        resolved: true,
        extraCandidates: [
          { productId: "00000000-0000-4000-9000-000000000001", name: "Alt cola 1" },
          { productId: "00000000-0000-4000-9000-000000000002", name: "Alt cola 2" },
        ],
      }),
      makeResolvedItem(1, {
        resolved: false,
        extraCandidates: [
          { productId: "00000000-0000-4000-9000-000000000011", name: "Wine A" },
          { productId: "00000000-0000-4000-9000-000000000012", name: "Wine B" },
        ],
      }),
      makeResolvedItem(2, {
        resolved: false,
        extraCandidates: [
          { productId: "00000000-0000-4000-9000-000000000021", name: "Ice A" },
        ],
      }),
    ]);

    await optimizeBasket({
      items: [
        { query: "cola", qty: 1 },
        { query: "wine", qty: 1 },
        { query: "ice", qty: 1 },
      ],
      city: "Herzliya",
    });

    expect(loadBasketPricingData).toHaveBeenCalledOnce();
    expect(loadBasketPricingData).toHaveBeenCalledWith([resolvedProductId], [STORE_ID], true);
  });
});
