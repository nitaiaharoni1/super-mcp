import { describe, expect, it } from "vitest";
import { computeUnitPrice, isGtinItem, normalizeMeasure } from "./units.js";

describe("normalizeMeasure", () => {
  it("converts kg to g", () => {
    expect(normalizeMeasure(1, "ק\"ג")).toMatchObject({
      quantity: 1000,
      unit: "g",
      unparseable: false,
    });
  });

  it("converts liter to ml", () => {
    expect(normalizeMeasure(1.5, "ליטר")).toMatchObject({
      quantity: 1500,
      unit: "ml",
      unparseable: false,
    });
  });

  it("flags unknown units", () => {
    expect(normalizeMeasure(2, "מארז").unparseable).toBe(true);
  });
});

describe("computeUnitPrice", () => {
  it("computes price per 100g", () => {
    const r = computeUnitPrice(10, 500, "גרם");
    expect(r.pricePerCanonical).toBeCloseTo(2, 5);
  });

  it("computes per-unit price", () => {
    const r = computeUnitPrice(24, 12, "יח");
    expect(r.pricePerCanonical).toBeCloseTo(2, 5);
  });
});

describe("isGtinItem", () => {
  it("accepts itemType 1 with 13 digits", () => {
    expect(isGtinItem(1, "7290000173199")).toBe(true);
  });

  it("rejects short internal codes", () => {
    expect(isGtinItem(0, "123")).toBe(false);
  });
});
