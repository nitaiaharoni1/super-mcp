import { describe, expect, it } from "vitest";
import { canonicalItemCode, computeUnitPrice, inferPackSizeFromName,
  isGtinItem,
  normalizeGtin,
  normalizeMeasure,
  resolvePurchaseQty,
} from "../../src/utils/units.js";

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

  it("parses spelled-out and plural Hebrew units (the 40% NULL unit_price cause)", () => {
    expect(normalizeMeasure(500, "מיליליטר")).toMatchObject({ quantity: 500, unit: "ml", unparseable: false });
    expect(normalizeMeasure(1, "קילוגרם")).toMatchObject({ quantity: 1000, unit: "g", unparseable: false });
    expect(normalizeMeasure(6, "יחידות")).toMatchObject({ quantity: 6, unit: "unit", unparseable: false });
    expect(normalizeMeasure(2, "ליטרים")).toMatchObject({ quantity: 2000, unit: "ml", unparseable: false });
    expect(normalizeMeasure(1.5, "קילוגרמים")).toMatchObject({ quantity: 1500, unit: "g", unparseable: false });
  });

  it("normalizes geresh/gershayim unit punctuation to match aliases", () => {
    expect(normalizeMeasure(500, "מ׳ל").unparseable).toBe(false); // geresh U+05F3
    expect(normalizeMeasure(1, "ק״ג")).toMatchObject({ quantity: 1000, unit: "g" }); // gershayim U+05F4
  });

  it("keeps embedded decimal quantity intact (1.5 ליטר → 1500ml, not 15000ml)", () => {
    // qty is present but the whole measure is embedded in the unit string; the
    // decimal-safe dot strip must not turn 1.5 into 15.
    expect(normalizeMeasure(1, "1.5 ליטר")).toMatchObject({ quantity: 1500, unit: "ml", unparseable: false });
  });

  it("parses embedded unit-only count (100 יחידות)", () => {
    expect(normalizeMeasure(1, "100 יחידות")).toMatchObject({ quantity: 100, unit: "unit", unparseable: false });
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

  it("accepts real EAN-13 / UPC-A / EAN-8 barcodes and zero-padded GTIN-14 (type 1)", () => {
    expect(isGtinItem(1, "036000291452")).toBe(true); // UPC-A (12)
    expect(isGtinItem(1, "96385074")).toBe(true); // EAN-8
    expect(isGtinItem(1, "00007290000173199")).toBe(true); // zero-padded GTIN-14
  });

  it("rejects ItemType-0 internal codes even at GTIN lengths", () => {
    expect(isGtinItem(0, "7290000173199")).toBe(false);
    expect(isGtinItem(0, "1234567890123")).toBe(false);
  });

  it("rejects RCN restricted-circulation codes (GS1 prefix 2)", () => {
    expect(isGtinItem(1, "2000000000001")).toBe(false); // in-store variable weight
    expect(isGtinItem(1, "0200000000001")).toBe(false); // padded RCN
    expect(isGtinItem(1, "29123456")).toBe(false); // RCN EAN-8
  });

  it("rejects non-GTIN lengths (9/10/11 digits) and alphanumeric internal codes", () => {
    expect(isGtinItem(1, "123456789")).toBe(false);
    expect(isGtinItem(1, "12345678901")).toBe(false);
    expect(isGtinItem(1, "AB-42")).toBe(false);
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

  it("keeps 8-digit codes that would shrink below 8 after stripping zeros", () => {
    expect(normalizeGtin("00001234")).toBe("00001234");
  });
});

describe("inferPackSizeFromName", () => {
  it("returns total multipack contents, not single-unit size", () => {
    expect(inferPackSizeFromName("קוקה קולה 6 * 1.5 ליטר")).toEqual({
      quantity: 9,
      unit: "ליטר",
    });
    expect(inferPackSizeFromName("יוגורט 10×100 גרם")).toEqual({ quantity: 1000, unit: "גרם" });
  });
});

describe("resolvePurchaseQty", () => {
  it("computes pack count from amount and package size", () => {
    const r = resolvePurchaseQty({
      amount: 1.5,
      unit: "קג",
      productSizeQty: 750,
      productSizeUnit: "גרם",
    });
    expect(r).toMatchObject({ qty: 2, mode: "packs" });
  });

  it("uses weighted kg for produce without package size", () => {
    const r = resolvePurchaseQty({ amount: 1.75, unit: "kg" });
    expect(r.mode).toBe("weighted_kg_or_l");
    expect(r.qty).toBeCloseTo(1.75, 5);
  });

  it("keeps legacy packQty when amount omitted", () => {
    expect(resolvePurchaseQty({ packQty: 3 })).toMatchObject({ qty: 3, mode: "legacy_packs" });
  });

  it("infers pack size from product name when size fields missing", () => {
    expect(
      resolvePurchaseQty({
        amount: 20,
        unit: "יח",
        productName: "פיתות 10יח אנג'ל",
      }),
    ).toMatchObject({ qty: 2, mode: "packs" });
  });

  it("uses name pack count even when DB size is package weight in grams", () => {
    expect(
      resolvePurchaseQty({
        amount: 20,
        unit: "יח",
        productName: "פיתות 10יח",
        productSizeQty: 480,
        productSizeUnit: "g",
      }),
    ).toMatchObject({ qty: 2, mode: "packs" });
  });

  it("parses מארז N and keeps small gram packs", () => {
    expect(resolvePurchaseQty({ amount: 20, unit: "יח", productName: "מארז 10 פיתות" })).toMatchObject({
      qty: 2,
      mode: "packs",
    });
    expect(
      resolvePurchaseQty({ amount: 200, unit: "g", productSizeQty: 40, productSizeUnit: "g" }),
    ).toMatchObject({ qty: 5, mode: "packs" });
  });

  it("counts one shelf pack for multipack total contents (6×1.5L)", () => {
    expect(
      resolvePurchaseQty({
        amount: 9,
        unit: "L",
        productName: "קוקה קולה 6 * 1.5 ליטר",
      }),
    ).toMatchObject({ qty: 1, mode: "packs" });
  });

  it("prefers an explicit name size when DB package metadata materially conflicts", () => {
    expect(
      resolvePurchaseQty({
        amount: 1.5,
        unit: "kg",
        productName: "חומוס הבית 250 גרם",
        productSizeQty: 410,
        productSizeUnit: "g",
      }),
    ).toMatchObject({ qty: 6, mode: "packs" });
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
