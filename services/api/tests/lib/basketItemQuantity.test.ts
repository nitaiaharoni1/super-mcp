import { describe, expect, it } from "vitest";
import { stripRedundantPackCountUnit } from "../../src/lib/basketItemQuantity.js";

describe("stripRedundantPackCountUnit", () => {
  it("drops count units when only pack_qty is set", () => {
    expect(stripRedundantPackCountUnit({ query: "חלב", pack_qty: 3, unit: "unit" })).toEqual({
      query: "חלב",
      pack_qty: 3,
    });
    expect(stripRedundantPackCountUnit({ query: "חלב", pack_qty: 3, unit: "יח" })).toEqual({
      query: "חלב",
      pack_qty: 3,
    });
  });

  it("leaves mass units and amount+unit untouched", () => {
    expect(stripRedundantPackCountUnit({ query: "חלב", pack_qty: 3, unit: "kg" })).toEqual({
      query: "חלב",
      pack_qty: 3,
      unit: "kg",
    });
    expect(
      stripRedundantPackCountUnit({ query: "עגבניות", amount: 1, unit: "kg" }),
    ).toEqual({
      query: "עגבניות",
      amount: 1,
      unit: "kg",
    });
  });
});
