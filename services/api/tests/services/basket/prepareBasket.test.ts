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

import { prepareBasket } from "../../../src/services/basket/prepare.js";

function makeCandidate(
  index: number,
  lineIndex: number,
  opts: {
    name?: string;
    score?: number;
    hasLocalPrice?: boolean;
    intentTier?: 1 | 2 | 3 | 0;
    sizeQty?: number;
  } = {},
): ResolvedItem["candidates"][number] {
  const candidateIndex = index;
  return {
    productId: `00000000-0000-4000-9${String(candidateIndex).padStart(3, "0")}-${String(lineIndex).padStart(12, "0")}`,
    name: opts.name ?? `Candidate ${candidateIndex}`,
    score: opts.score ?? 0.5 - candidateIndex * 0.01,
    matchedVia: "product",
    sizeQty: opts.sizeQty ?? candidateIndex + 1,
    sizeUnit: "unit",
    hasPrice: true,
    hasLocalPrice: opts.hasLocalPrice ?? candidateIndex % 2 === 0,
    productClass: null,
    ...(opts.intentTier !== undefined ? { intentTier: opts.intentTier } : {}),
  };
}

function makeResolvedItem(
  index: number,
  opts: {
    resolved?: boolean;
    query?: string;
    name?: string;
    resolvedBy?: ResolvedItem["resolvedBy"];
    candidateCount?: number;
    candidates?: ResolvedItem["candidates"];
  } = {},
): ResolvedItem {
  const resolved = opts.resolved ?? false;
  const productId = resolved ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` : null;
  const candidateCount = opts.candidateCount ?? 1;
  return {
    index,
    qty: 1,
    qtyMode: "legacy_packs",
    amount: null,
    unit: null,
    productId,
    name: opts.name ?? (resolved ? `Product ${index}` : `Query ${index}`),
    resolvedBy: opts.resolvedBy ?? (resolved ? "query" : "unresolved"),
    resolutionStatus: resolved ? "resolved" : "needs_confirmation",
    confidence: resolved ? 0.95 : null,
    lowConfidence: !resolved,
    candidates:
      opts.candidates ??
      Array.from({ length: candidateCount }, (_, candidateIndex) =>
        makeCandidate(candidateIndex, index, {
          name: opts.name ?? (resolved ? `Product ${index}` : `Candidate ${candidateIndex}`),
          score: (resolved ? 0.95 : 0.5) - candidateIndex * 0.01,
        }),
      ),
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

describe("prepareBasket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("returns resolved items and completeness without loading prices", async () => {
    resolveItems.mockResolvedValue([
      makeResolvedItem(0, { resolved: true, name: "Coca-Cola 1.5L", resolvedBy: "query" }),
      makeResolvedItem(1, { resolved: false }),
    ]);

    const result = await prepareBasket({
      items: [
        { query: "קולה", qty: 1 },
        { query: "יין", qty: 1 },
      ],
      city: "הרצליה",
    });

    expect(loadBasketPricingData).not.toHaveBeenCalled();
    expect(listStores).toHaveBeenCalledOnce();
    expect(resolveItems).toHaveBeenCalledOnce();
    // Resolved storeIds are the sole search location predicate (no city re-check).
    expect(resolveItems).toHaveBeenCalledWith(
      expect.any(Array),
      {
        storeIds: ["11111111-1111-4111-8111-111111111111"],
      },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.resolutionStatus).toBe("resolved");
    expect(result.items[1]?.resolutionStatus).toBe("needs_confirmation");
    expect(result.completeness.requestedLines).toBe(2);
    expect(result.completeness.resolvedLines).toBe(1);
    expect(result.completeness.needsConfirmationLines).toBe(1);
    expect(result.completeness.totalsArePartial).toBe(true);
    expect(result.assumptions).toEqual(['"קולה" → Coca-Cola 1.5L']);
    expect(result.questions).toEqual([
      {
        itemIndex: 1,
        id: "basket-item-1-product",
        prompt: 'Which product should be used for "יין"?',
        reason: "This line has multiple or insufficiently strong product matches.",
        required: true,
        options: [
          {
            productId: "00000000-0000-4000-9000-000000000001",
            name: "Candidate 0",
            sizeQty: 1,
            sizeUnit: "unit",
            hasLocalPrice: true,
          },
        ],
      },
    ]);
  });

  it("bounds serialized candidates and question options without mutating internal ranking", async () => {
    const ambiguous = makeResolvedItem(0, { candidateCount: 9 });
    const resolved = makeResolvedItem(1, { resolved: true, candidateCount: 9 });
    resolveItems.mockResolvedValue([ambiguous, resolved]);

    const result = await prepareBasket({
      items: [
        { query: "generic ambiguous item", qty: 1 },
        { query: "generic resolved item", qty: 1 },
      ],
      city: "Herzliya",
    });

    expect(ambiguous.candidates).toHaveLength(9);
    expect(resolved.candidates).toHaveLength(9);
    expect(ambiguous.candidates.map((c) => c.name)).toEqual([
      "Candidate 0",
      "Candidate 1",
      "Candidate 2",
      "Candidate 3",
      "Candidate 4",
      "Candidate 5",
      "Candidate 6",
      "Candidate 7",
      "Candidate 8",
    ]);
    expect(result.questions[0]?.options).toHaveLength(5);
    expect(result.items[0]?.candidates).toHaveLength(5);
    expect(result.items[1]?.candidates).toHaveLength(0);
    // Local-priced candidates are preferred into the capped shortlist.
    expect(result.questions[0]?.options.map((o) => o.name)).toEqual([
      "Candidate 0",
      "Candidate 2",
      "Candidate 4",
      "Candidate 6",
      "Candidate 8",
    ]);
    expect(result.items[0]?.candidates.map((c) => c.name)).toEqual([
      "Candidate 0",
      "Candidate 2",
      "Candidate 4",
      "Candidate 6",
      "Candidate 8",
    ]);
    expect(JSON.stringify(result)).not.toContain("Candidate 7");
  });

  it("prefers hasLocalPrice then score for agent-facing shortlists", async () => {
    const ambiguous = makeResolvedItem(0, {
      candidates: [
        makeCandidate(0, 0, {
          name: "מכונת קרח ביתית",
          score: 0.95,
          hasLocalPrice: false,
          intentTier: 3,
        }),
        makeCandidate(1, 0, {
          name: "קוביות קרח לוויסקי",
          score: 0.9,
          hasLocalPrice: false,
          intentTier: 3,
        }),
        makeCandidate(2, 0, {
          name: "שקית קרח",
          score: 0.72,
          hasLocalPrice: true,
          intentTier: 1,
        }),
        makeCandidate(3, 0, {
          name: "קוביות קרח",
          score: 0.7,
          hasLocalPrice: true,
          intentTier: 1,
        }),
        makeCandidate(4, 0, {
          name: "קרח כתוש",
          score: 0.68,
          hasLocalPrice: true,
          intentTier: 2,
        }),
        makeCandidate(5, 0, {
          name: "מצנן קרח",
          score: 0.88,
          hasLocalPrice: false,
          intentTier: 3,
        }),
      ],
    });
    resolveItems.mockResolvedValue([ambiguous]);

    const result = await prepareBasket({
      items: [{ query: "קרח", qty: 1 }],
      city: "Herzliya",
    });

    expect(ambiguous.candidates[0]?.name).toBe("מכונת קרח ביתית");
    expect(result.questions[0]?.options.map((o) => o.name)).toEqual([
      "שקית קרח",
      "קוביות קרח",
      "קרח כתוש",
      "מכונת קרח ביתית",
      "קוביות קרח לוויסקי",
    ]);
    expect(result.items[0]?.candidates.map((c) => c.name)).toEqual([
      "שקית קרח",
      "קוביות קרח",
      "קרח כתוש",
      "מכונת קרח ביתית",
      "קוביות קרח לוויסקי",
    ]);
    expect(result.questions[0]?.options.every((o) => typeof o.hasLocalPrice === "boolean")).toBe(
      true,
    );
  });

  it("deprioritizes worse-tier candy/appliance picks behind safer local options", async () => {
    const ambiguous = makeResolvedItem(0, {
      candidates: [
        makeCandidate(0, 0, {
          name: "סוכריות גומי בטעם קולה",
          score: 0.99,
          hasLocalPrice: true,
          intentTier: 3,
        }),
        makeCandidate(1, 0, {
          name: "קוקה קולה 1.5 ליטר",
          score: 0.8,
          hasLocalPrice: true,
          intentTier: 1,
        }),
        makeCandidate(2, 0, {
          name: "RC קולה",
          score: 0.78,
          hasLocalPrice: true,
          intentTier: 1,
        }),
        makeCandidate(3, 0, {
          name: "קולה דיאט",
          score: 0.85,
          hasLocalPrice: false,
          intentTier: 2,
        }),
      ],
    });
    resolveItems.mockResolvedValue([ambiguous]);

    const result = await prepareBasket({
      items: [{ query: "קולה", qty: 1 }],
      city: "Herzliya",
    });

    expect(result.questions[0]?.options.map((o) => o.name)).toEqual([
      "קוקה קולה 1.5 ליטר",
      "RC קולה",
      "סוכריות גומי בטעם קולה",
      "קולה דיאט",
    ]);
  });

  it("does not describe a needs-confirmation selection as an assumption", async () => {
    const contradictory = makeResolvedItem(0, { resolved: true });
    contradictory.resolutionStatus = "needs_confirmation";
    contradictory.lowConfidence = true;
    resolveItems.mockResolvedValue([contradictory]);

    const result = await prepareBasket({
      items: [{ query: "ambiguous line", qty: 1 }],
      city: "Herzliya",
    });

    expect(result.assumptions).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.required).toBe(true);
  });

  it("rejects empty items", async () => {
    await expect(prepareBasket({ items: [], city: "הרצליה" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("requires city or near", async () => {
    await expect(prepareBasket({ items: [{ query: "חלב", qty: 1 }] })).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});
