import { describe, expect, it } from "vitest";
import {
  canonicalItemCode,
  computeUnitPrice,
  isGtinItem,
  normalizeGtin,
  normalizeMeasure,
} from "./units.js";

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

describe("normalizeGtin", () => {
  it("strips non-digits", () => {
    expect(normalizeGtin(" 7290-000173199 ")).toBe("7290000173199");
  });

  it("strips leading zeros so padded GTINs merge (GTIN-14 padding, EAN-13 = 0 + UPC-A)", () => {
    expect(normalizeGtin("07290000173199")).toBe("7290000173199");
    expect(normalizeGtin("0007290000173199")).toBe("7290000173199");
  });

  it("keeps degenerate short codes unchanged", () => {
    expect(normalizeGtin("0000123")).toBe("0000123");
  });
});

describe("canonicalItemCode", () => {
  it("returns the normalized GTIN for barcode-capable codes", () => {
    expect(canonicalItemCode(1, "07290000173199")).toBe("7290000173199");
  });

  it("returns internal codes unchanged", () => {
    expect(canonicalItemCode(0, "INTERNAL-42")).toBe("INTERNAL-42");
    expect(canonicalItemCode(1, "123")).toBe("123");
  });
});
