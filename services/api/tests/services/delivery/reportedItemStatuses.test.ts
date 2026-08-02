import { heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { describe, expect, it } from "vitest";
import { buildItemStatuses } from "../../../src/services/basket/optimize.js";
import { applyFastResolutionPolicy } from "../../../src/services/basket/resolutionPolicy.js";
import type {
  BasketCandidate,
  CandidateAvailability,
  ResolvedItem,
} from "../../../src/services/basket/types.js";

/**
 * `optimize_delivery` reported the resolution it had BEFORE the fast policy ran.
 *
 * Live against production: a line for `קוטג 5%` came back as
 * "קוטג 5% עם שום שמיר" with `resolved: true` and confidence 0.95, while every
 * plan under `plans[].lines` priced "קוטג' 5% שומן" — a different tub. A line for
 * `שמן זית` was reported `resolved: false, productId: null` while four
 * storefronts had quoted a specific bottle. An agent reading `items[]` back to a
 * shopper therefore named products nobody was buying.
 *
 * The physical surface never had this: `optimize.ts` rebuilds its statuses from
 * the policy's output. These tests pin the composition both surfaces now share,
 * so the pre-policy list cannot quietly become the reported one again.
 */

function cand(
  partial: Partial<BasketCandidate> & Pick<BasketCandidate, "productId" | "name">,
): BasketCandidate {
  return {
    score: 0.9,
    matchedVia: "product",
    sizeQty: 250,
    sizeUnit: "g",
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "dairy",
    classL1: "dairy_eggs",
    classL2: "cottage_cheese",
    classL3: null,
    variant: "regular",
    brandExtracted: null,
    intentTier: 1,
    ...partial,
  };
}

function availability(entries: Array<[string, number]>): Map<string, CandidateAvailability> {
  return new Map(
    entries.map(([productId, pricedStoreCount]) => [
      productId,
      { pricedStoreCount, chainCount: Math.min(pricedStoreCount, 5), minPrice: 6 },
    ]),
  );
}

function resolvedLine(
  productId: string | null,
  name: string,
  candidates: BasketCandidate[],
  overrides: Partial<ResolvedItem> = {},
): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId,
    name,
    resolvedBy: productId == null ? "unresolved" : "query",
    resolutionStatus: productId == null ? "unresolved" : "resolved",
    confidence: productId == null ? null : 0.95,
    lowConfidence: productId == null,
    candidates,
    primaryProductId: null,
    primaryName: null,
    substitution: null,
    ...overrides,
  };
}

const ontology = heRetailOntologyFixture();

describe("statuses reported to the caller follow the priced items", () => {
  it("names the product the swap landed on, not the one it left", () => {
    const flavoured = cand({
      productId: "flavoured",
      name: "קוטג 5% עם שום שמיר 250 גרם",
      score: 0.97,
    });
    const plain = cand({ productId: "plain", name: "קוטג' 5% שומן 250 גרם", score: 0.93 });

    const policy = applyFastResolutionPolicy(
      [{ query: "קוטג 5%", packQty: 1 }],
      [resolvedLine("flavoured", flavoured.name, [flavoured, plain])],
      availability([
        ["flavoured", 2],
        ["plain", 91],
      ]),
      ontology,
    );

    expect(policy.items[0]?.productId).toBe("plain");

    const reported = buildItemStatuses(policy.items);
    expect(reported[0]?.productId).toBe("plain");
    expect(reported[0]?.name).toBe("קוטג' 5% שומן 250 גרם");

    // The bug, stated as the thing that must stay false: the pre-policy list is a
    // different answer, so returning it is not a harmless alias.
    const prePolicy = buildItemStatuses([
      resolvedLine("flavoured", flavoured.name, [flavoured, plain]),
    ]);
    expect(prePolicy[0]?.productId).not.toBe(reported[0]?.productId);
  });

  it("stops calling a line unresolved once the policy has priced it", () => {
    const pick = cand({
      productId: "oil",
      name: "שמן זית כתית מעולה 750 מל",
      classL1: "pantry",
      classL2: "olive_oil",
      score: 0.88,
    });

    const policy = applyFastResolutionPolicy(
      [{ query: "שמן זית", packQty: 1 }],
      [
        resolvedLine(null, "שמן זית", [pick], {
          resolvedBy: "unresolved",
          resolutionStatus: "unresolved",
        }),
      ],
      availability([["oil", 64]]),
      ontology,
    );

    // Only meaningful if the policy did in fact choose something.
    expect(policy.items[0]?.productId).toBe("oil");

    const reported = buildItemStatuses(policy.items);
    expect(reported[0]?.resolved).toBe(true);
    expect(reported[0]?.resolutionStatus).not.toBe("unresolved");
    expect(reported[0]?.productId).toBe("oil");
  });
});
