import { describe, expect, it } from "vitest";
import {
  percentConflict,
  percentagesIn,
  rejectPercentMismatch,
  requestedPercent,
} from "../../../src/services/basket/percentAttribute.js";

describe("percentagesIn", () => {
  it("reads every percentage in the string", () => {
    expect([...percentagesIn("קוטג' תנובה 5% שומן 250 ג'")]).toEqual([5]);
    expect([...percentagesIn("קוקומן חום לבן 20% פחות סוכר 375 גרם")]).toEqual([20]);
    expect([...percentagesIn("גבינה צהובה עמק 28% שומן, 9% מ.ש")]).toEqual([28, 9]);
    expect([...percentagesIn("חמאה תנובה 200 גרם")]).toEqual([]);
    expect([...percentagesIn(null)]).toEqual([]);
  });

  it("accepts a decimal comma, which the feeds emit", () => {
    expect([...percentagesIn("חלב 1,5% שומן")]).toEqual([1.5]);
  });
});

describe("requestedPercent", () => {
  it("returns the single percentage the shopper named", () => {
    expect(requestedPercent("קוטג׳ תנובה 5%")).toBe(5);
    expect(requestedPercent("חלב 3%")).toBe(3);
  });

  it("treats no percentage or an ambiguous pair as unspecified", () => {
    expect(requestedPercent("חמאה")).toBeNull();
    expect(requestedPercent("גבינה 5% או 9%")).toBeNull();
  });
});

describe("rejectPercentMismatch", () => {
  it("rejects a candidate that contradicts an explicitly requested percentage", () => {
    // The live failure: an explicit 5% ask resolved to 1%.
    expect(rejectPercentMismatch("קוטג׳ תנובה 5%", "קוטג תנובה 1% 250 גרם")).toBe(true);
    expect(rejectPercentMismatch("חלב 3%", "חלב 1% בקרטון")).toBe(true);
  });

  it("keeps a candidate that states the requested percentage", () => {
    expect(rejectPercentMismatch("קוטג׳ תנובה 5%", "קוטג' תנובה 5% שומן 250 ג' בד\"צ")).toBe(
      false,
    );
  });

  it("keeps a candidate that states no percentage at all", () => {
    // Plenty of correct SKUs omit it; rejecting them would starve the pool for a
    // constraint the catalog does not always print.
    expect(rejectPercentMismatch("חלב 3%", "חלב תנובה בקרטון 1 ליטר")).toBe(false);
  });

  it("is inert when the query names no percentage", () => {
    expect(rejectPercentMismatch("קוטג׳", "קוטג תנובה 1% 250 גרם")).toBe(false);
  });
});

describe("percentConflict", () => {
  it("separates fat levels the taxonomy labels identically", () => {
    // Both are variant="regular" in product_class_map, so variantConflict sees
    // no disagreement and grouped 1% with 9% cottage on one basket line.
    expect(
      percentConflict(
        { name: "קוטג תנובה 1% 250 גרם" },
        { name: "קוטג' תנובה 9% שומן 250 ג'" },
      ),
    ).toBe(true);
  });

  it("does not conflict when the percentages overlap", () => {
    expect(
      percentConflict(
        { name: "קוטג' תנובה 5% שומן 250 ג' בד\"צ" },
        { name: "קוטג' 5% שומן 250 גרם" },
      ),
    ).toBe(false);
  });

  it("treats an absent percentage as unknown, not as a conflict", () => {
    expect(
      percentConflict({ name: "חמאה תנובה 200 גרם" }, { name: "חמאה איטלקית 100 גרם" }),
    ).toBe(false);
  });
});
