import { describe, expect, it } from "vitest";
import { classifyResolutionLine } from "../../../src/services/basket/optimize.js";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

function base(partial: Partial<ResolvedItem>): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: null,
    name: "חלב",
    resolvedBy: "unresolved",
    resolutionStatus: "unresolved",
    confidence: null,
    lowConfidence: true,
    candidates: [
      {
        productId: "x",
        name: "חלב מרוכז",
        score: 0.9,
        matchedVia: "product",
        sizeQty: 1,
        sizeUnit: "L",
        pieceCount: null,
        hasPrice: true,
        hasLocalPrice: true,
        productClass: "dairy",
      },
    ],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
    ...partial,
  };
}

describe("classifyResolutionLine", () => {
  it("keeps explicit unresolved (fast omit) even when candidates remain", () => {
    expect(classifyResolutionLine(base({ resolutionStatus: "unresolved" }))).toBe("unresolved");
  });

  it("preserves needs_confirmation when still pending", () => {
    expect(
      classifyResolutionLine(base({ resolutionStatus: "needs_confirmation" })),
    ).toBe("needs_confirmation");
  });

  it("classifies resolved primaries as resolved", () => {
    expect(
      classifyResolutionLine(
        base({
          productId: "p1",
          name: "חלב טרי 3%",
          resolutionStatus: "resolved",
          lowConfidence: false,
          confidence: 0.9,
        }),
      ),
    ).toBe("resolved");
  });
});
