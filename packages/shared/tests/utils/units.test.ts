import { describe, expect, it } from "vitest";
import { canonicalItemCode, computeUnitPrice, inferPackSizeFromName,
  isGtinItem,
  normalizeGtin,
  normalizeMeasure,
  packSizesCompatible,
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

  it("uses packQty as pack count when amount omitted", () => {
    expect(resolvePurchaseQty({ packQty: 3 })).toMatchObject({ qty: 3, mode: "packs" });
  });

  it("treats weighted produce pack_qty as piece count (watermelon → ~4kg)", () => {
    const r = resolvePurchaseQty({
      packQty: 1,
      productName: "אבטיח",
      isWeighted: true,
    });
    expect(r.mode).toBe("weighted_kg_or_l");
    expect(r.qty).toBeCloseTo(4, 5);
  });

  it("does not treat פרימיום as a produce cue (פרי substring)", () => {
    const r = resolvePurchaseQty({
      packQty: 1,
      productName: "גבינה פרימיום",
      saleBasis: "per_kg",
    });
    expect(r).toMatchObject({ qty: 1, mode: "weighted_kg_or_l" });
  });

  it("treats weighted pack_qty as kg when name is not produce", () => {
    expect(
      resolvePurchaseQty({
        packQty: 1.5,
        productName: "חזה עוף טרי",
        saleBasis: "per_kg",
      }),
    ).toMatchObject({ qty: 1.5, mode: "weighted_kg_or_l" });
  });

  it("uses packs for non-weighted pack_qty", () => {
    expect(
      resolvePurchaseQty({
        packQty: 1,
        productName: "אבטיח ארוז",
        isWeighted: false,
      }),
    ).toMatchObject({ qty: 1, mode: "packs" });
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

  it("converts count to approx weight for weighted lemons with no unit pack (4 לימונים)", () => {
    const r = resolvePurchaseQty({
      amount: 4,
      unit: "יח",
      productName: "לימון",
    });
    expect(r.mode).toBe("weighted_kg_or_l");
    expect(r.qty).toBeCloseTo(0.48, 5);
  });

  it("converts count to approx weight for weighted peppers (3 פלפלים)", () => {
    const r = resolvePurchaseQty({
      amount: 3,
      unit: "יח",
      productName: "פלפל אדום",
    });
    expect(r.mode).toBe("weighted_kg_or_l");
    expect(r.qty).toBeCloseTo(0.48, 5);
  });

  it("falls back to the 0.15kg/piece default for unknown produce sold by count", () => {
    const r = resolvePurchaseQty({
      amount: 2,
      unit: "יח",
      productName: "ירק לא ידוע",
    });
    expect(r.mode).toBe("weighted_kg_or_l");
    expect(r.qty).toBeCloseTo(0.3, 5);
  });

  it("buys bottled wine by unit count, not inventing a 0.15kg piece weight", () => {
    expect(
      resolvePurchaseQty({
        amount: 1,
        unit: "יח",
        productSizeQty: 750,
        productSizeUnit: "ml",
        productName: 'יין אדום מונטפולציאנו 750 מ"ל',
      }),
    ).toMatchObject({ qty: 1, mode: "units" });
  });

  it("buys packaged hummus tubs by unit count despite gram size metadata", () => {
    expect(
      resolvePurchaseQty({
        amount: 1,
        unit: "יח",
        productSizeQty: 400,
        productSizeUnit: "g",
        productName: "אחלה חומוס 400ג",
      }),
    ).toMatchObject({ qty: 1, mode: "units" });
  });

  it("still returns packs (unchanged) when a real unit-pack exists (20 פיתות @ 10/pack)", () => {
    const r = resolvePurchaseQty({
      amount: 20,
      unit: "יח",
      productName: "פיתות 10יח אנג'ל",
    });
    expect(r).toMatchObject({ qty: 2, mode: "packs" });
  });

  it("uses persisted pieceCount when a gram-sized multipack has no count in its name", () => {
    expect(
      resolvePurchaseQty({
        amount: 20,
        unit: "יח",
        productSizeQty: 1000,
        productSizeUnit: "g",
        productName: "פיתות ביתי דגנית",
        pieceCount: 10,
      }),
    ).toEqual({ qty: 2, mode: "packs" });
  });

  it("prefers an explicit name count over conflicting persisted pieceCount", () => {
    expect(
      resolvePurchaseQty({
        amount: 20,
        unit: "יח",
        productName: "פיתות 8 יח",
        pieceCount: 10,
      }),
    ).toEqual({ qty: 3, mode: "packs" });
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

describe("packSizesCompatible", () => {
  it("treats kg and g as the same canonical weight", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 1, sizeUnit: "kg", name: "עגבניות" },
        { sizeQty: 1000, sizeUnit: "g", name: "עגבניות חממה" },
      ).compatible,
    ).toBe(true);
  });

  it("treats יח and unit as the same count unit", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 1, sizeUnit: "יח", name: "בצל" },
        { sizeQty: 1, sizeUnit: "unit", name: "בצל אדום" },
      ).compatible,
    ).toBe(true);
  });

  it("allows unit↔g when allowCountToWeight (produce)", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 1, sizeUnit: "unit", name: "בצל" },
        { sizeQty: 1000, sizeUnit: "g", name: "בצל יבש" },
        { allowCountToWeight: true },
      ).compatible,
    ).toBe(true);
  });

  it("blocks unit↔g when allowCountToWeight is false (salt)", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 1000, sizeUnit: "g", name: "מלח גס" },
        { sizeQty: 1, sizeUnit: "unit", name: "מלח גס יחידה" },
        { allowCountToWeight: false },
      ).compatible,
    ).toBe(false);
  });

  it("treats name-inferred multipack (10 יח) as unit pack even when DB says grams", () => {
    // Both resolve to unit×10 — same_unit path, not count↔weight bypass.
    expect(
      packSizesCompatible(
        { sizeQty: 1000, sizeUnit: "g", name: "פיתות 10 יח" },
        { sizeQty: 10, sizeUnit: "unit", name: "פיתה אסלי 10 יח" },
        { allowCountToWeight: false },
      ).compatible,
    ).toBe(true);
  });

  it("blocks bare unit↔g without allowCountToWeight even if name has יח on the weight side only", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 1, sizeUnit: "unit", name: "מלח גס" },
        { sizeQty: 1000, sizeUnit: "g", name: "מלח גס 1 קג" },
        { allowCountToWeight: false },
      ).compatible,
    ).toBe(false);
  });

  it("allows null vs g/ml only when allowCountToWeight", () => {
    expect(
      packSizesCompatible(
        { sizeQty: null, sizeUnit: null, name: "אבטיח" },
        { sizeQty: 1000, sizeUnit: "g", name: "אבטיח אדום" },
        { allowCountToWeight: true },
      ).compatible,
    ).toBe(true);
    expect(
      packSizesCompatible(
        { sizeQty: null, sizeUnit: null, name: "מלח" },
        { sizeQty: 1000, sizeUnit: "g", name: "מלח גס" },
        { allowCountToWeight: false },
      ).compatible,
    ).toBe(false);
  });

  it("rejects wine packs beyond tolerance (750 vs 2000)", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 750, sizeUnit: "ml", name: "יין אדום" },
        { sizeQty: 2000, sizeUnit: "ml", name: "יין אדום ביתי" },
        { packTolerance: 0.5 },
      ).compatible,
    ).toBe(false);
  });

  it("skips qty tolerance when either sizeQty is missing (unit-only stub)", () => {
    expect(
      packSizesCompatible(
        { sizeQty: null, sizeUnit: "ml", name: "יין אדום קברנה" },
        { sizeQty: 750, sizeUnit: "ml", name: "יין אדום קברנה סוביניון" },
      ).compatible,
    ).toBe(true);
  });

  it("skips qty tolerance for 1g/1ml catalog stubs vs real packs", () => {
    expect(
      packSizesCompatible(
        { sizeQty: 1, sizeUnit: "g", name: "חומוס" },
        { sizeQty: 400, sizeUnit: "g", name: "אחלה חומוס 400ג" },
      ).compatible,
    ).toBe(true);
  });

  it("treats both unparseable packs as compatible", () => {
    expect(
      packSizesCompatible(
        { sizeQty: null, sizeUnit: null, name: "חומוס" },
        { sizeQty: null, sizeUnit: null, name: "חומוס אסלי" },
      ).compatible,
    ).toBe(true);
  });
});
