import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import {
  classifyBrandFamilyPeers,
  coverageQueryText,
  diversifyByChain,
  enrichCommodityCoverage,
  filterClassPeers,
  isCoverageTarget,
  packageFormKind,
  packageFormsCompatible,
} from "../../../src/services/basket/commodityCoverage.js";
import type { BasketCandidate, BasketItemInput, ResolvedItem } from "../../../src/services/basket/types.js";

const primary = (over: Partial<BasketCandidate>): BasketCandidate => ({
  productId: "primary",
  name: "מלפפונים",
  score: 0.9,
  matchedVia: "product",
  sizeQty: null,
  sizeUnit: "kg",
  pieceCount: null,
  hasPrice: true,
  hasLocalPrice: true,
  productClass: "produce",
  classL1: "produce",
  classL2: "vegetable_fresh",
  classL3: "cucumber",
  variant: "regular",
  ...over,
});

const row = (id: string, name: string, size_unit: string | null = "kg", size_qty: number | null = null) => ({
  product_id: id,
  name,
  size_qty,
  size_unit,
});

function resolvedLine(over: Partial<ResolvedItem>): ResolvedItem {
  return {
    index: 0,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: "primary",
    name: "מלפפונים",
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 1,
    lowConfidence: false,
    candidates: [primary({})],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
    ...over,
  };
}

// filterClassPeers now only holds query SPECIFICITY (morphology-tolerant) + unit;
// class and variant are filtered in SQL (fetchCarriedClassPeers).
describe("filterClassPeers", () => {
  it("keeps per-chain twins across Hebrew plural/singular (מלפפונים↔מלפפון)", () => {
    const kept = filterClassPeers(
      "מלפפונים",
      primary({}),
      [row("a", "מלפפון"), row("b", "מלפפון ארוז"), row("c", "מלפפונים")],
    );
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b", "c"]);
  });

  it("holds query specificity: a cabernet line excludes merlot", () => {
    const wine = primary({
      name: "יין אדום קברנה",
      sizeUnit: "ml",
      sizeQty: 750,
      productClass: "beverage",
      classL1: "beverage",
      classL2: "wine",
      classL3: "red_wine",
    });
    const kept = filterClassPeers(
      "יין אדום קברנה",
      wine,
      [row("cab", "יין אדום קברנה סוביניון", "ml", 750), row("merlot", "יין אדום מרלו", "ml", 750)],
    );
    expect(kept.map((r) => r.product_id)).toEqual(["cab"]);
  });

  it("excludes unit↔g for non-produce (salt)", () => {
    const salt = primary({
      name: "מלח גס",
      productClass: "pantry",
      classL1: "pantry",
      classL2: "seasoning",
      classL3: "salt",
      sizeUnit: "g",
      sizeQty: 1000,
    });
    const kept = filterClassPeers("מלח גס", salt, [
      row("a", "מלח גס 1 קג", "g", 1000),
      row("u", "מלח גס יחידה", "unit", 1),
    ]);
    expect(kept.map((r) => r.product_id)).toEqual(["a"]);
  });

  it("keeps produce unit primary with g peer (onion / בצל יבש)", () => {
    const onion = primary({
      name: "בצל",
      sizeUnit: "unit",
      sizeQty: 1,
      classL3: "onion",
    });
    const kept = filterClassPeers("בצלים", onion, [
      row("a", "בצל יבש", "g", 1000),
      row("b", "בצל אדום", "unit", 1),
    ]);
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b"]);
  });

  it("keeps bakery unit primary with gram-labeled pita peers (פיתות↔פיתה)", () => {
    const pita = primary({
      name: "פיתות עננים פיתה אקס",
      sizeUnit: "unit",
      sizeQty: 1,
      productClass: "bakery",
      classL1: "bakery",
      classL2: "pita_flatbread",
      classL3: "pita",
    });
    const kept = filterClassPeers("פיתות", pita, [
      row("a", "פיתה קריצה ארטיזן 8 יחידות", "unit", 8),
      row("b", "פיתות 10 יחידות אנג'ל 1 ק\"ג", "g", 1000),
      row("c", "בייגלה מלוח", "g", 400),
    ]);
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b"]);
  });

  it("keeps wine unit-stub primary with 750ml branch peers (יין count↔volume)", () => {
    const wineStub = primary({
      name: "יין זמירות אכסוף",
      productClass: "alcohol",
      classL1: "alcohol",
      classL2: "wine",
      classL3: null,
      sizeUnit: "unit",
      sizeQty: 1,
    });
    const kept = filterClassPeers(
      "יין",
      wineStub,
      [
        row("stub", "יין זמירות אכסוף", "unit", 1),
        row("ml-cheap", "יין לבן זול", "ml", 750),
        row("ml-red", "יין אדום 750", "ml", 750),
        row("box", "יין בקרטון 3 ל", "ml", 3000),
      ],
      { allowCountToWeight: true },
    );
    // 750ml bottles must survive; larger boxed wine may also pass pack tolerance.
    expect(kept.map((r) => r.product_id)).toEqual(
      expect.arrayContaining(["ml-cheap", "ml-red", "stub"]),
    );
    expect(kept.some((r) => r.product_id === "ml-cheap")).toBe(true);
  });

  it("diversifies capped peers across chains", () => {
    const onion = primary({
      name: "בצל",
      sizeUnit: "unit",
      sizeQty: 1,
      classL3: "onion",
    });
    const many = Array.from({ length: 25 }, (_, i) => ({
      product_id: `c0-${i}`,
      name: `בצל רשת ${i}`,
      size_qty: 1000,
      size_unit: "g",
      chain_id: "chain-a",
    })).concat([
      {
        product_id: "other",
        name: "בצל יבש",
        size_qty: 1000,
        size_unit: "g",
        chain_id: "chain-b",
      },
    ]);
    const kept = filterClassPeers("בצל", onion, many);
    expect(kept).toHaveLength(20);
    expect(kept.some((r) => r.product_id === "other")).toBe(true);
  });

  it("retains the globally cheapest peer when more than 20 compatible wines exist", () => {
    const expensive = Array.from({ length: 25 }, (_, i) => ({
      product_id: `w-${String(i).padStart(2, "0")}`,
      name: `יין אדום ${i}`,
      size_qty: 750,
      size_unit: "ml",
      chain_id: "chain-a",
      min_price: 40 + i,
    }));
    const cheapest = {
      product_id: "cheap-white",
      name: "יין לבן זול",
      size_qty: 750,
      size_unit: "ml",
      chain_id: "chain-b",
      min_price: 19.9,
    };
    const kept = diversifyByChain([...expensive, cheapest], 20);
    expect(kept).toHaveLength(20);
    expect(kept.some((r) => r.product_id === "cheap-white")).toBe(true);
  });

  it("returns [] on an empty query", () => {
    expect(filterClassPeers("", primary({}), [row("a", "מלפפון")])).toEqual([]);
  });
});

describe("isCoverageTarget / coverageQueryText (product_id broadening)", () => {
  it("includes confirmed product_id lines even without a free-text query (class stamp only)", () => {
    // Still a coverage target so missing class metadata can be loaded/stamped;
    // enrichCommodityCoverage skips peer fetch when intent.mode === "exact".
    const items: BasketItemInput[] = [{ productId: "primary", packQty: 1 }];
    expect(
      isCoverageTarget(
        resolvedLine({ resolvedBy: "product_id", resolutionStatus: undefined }),
        items,
      ),
    ).toBe(true);
  });

  it("includes gtin lines; excludes unresolved and needs_confirmation query lines", () => {
    const items: BasketItemInput[] = [
      { gtin: "7290000000000", packQty: 1 },
      { query: "מלפפונים", packQty: 1 },
      { query: "מלפפונים", packQty: 1 },
    ];
    expect(
      isCoverageTarget(resolvedLine({ index: 0, resolvedBy: "gtin", resolutionStatus: undefined }), items),
    ).toBe(true);
    expect(
      isCoverageTarget(
        resolvedLine({ index: 1, resolvedBy: "query", resolutionStatus: "needs_confirmation" }),
        items,
      ),
    ).toBe(false);
    expect(
      isCoverageTarget(
        resolvedLine({
          index: 2,
          resolvedBy: "unresolved",
          productId: null,
          resolutionStatus: "unresolved",
        }),
        items,
      ),
    ).toBe(false);
  });

  it("prefers item.query for peer filtering, else primary.name (product_id-only)", () => {
    const p = primary({ name: "מלפפון שופרסל" });
    expect(coverageQueryText({ query: "מלפפונים", packQty: 1 }, p)).toBe("מלפפונים");
    expect(coverageQueryText({ productId: "primary", packQty: 1 }, p)).toBe("מלפפון שופרסל");
  });

  it("filterClassPeers requireQueryTokens:false still allows brand-agnostic peers", () => {
    const p = primary({ name: "עגבניות שופרסל", brandExtracted: "שופרסל", classL3: "tomato" });
    const kept = filterClassPeers(
      "עגבניות שופרסל",
      p,
      [row("a", "עגבניות רמי לוי"), row("b", "עגבניות"), row("c", "מלפפונים")],
      { requireQueryTokens: false },
    );
    // Helper option remains; enrich no longer uses it for product_id-only lines
    // (those skip peer fetch entirely).
    expect(kept.map((r) => r.product_id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("enrichCommodityCoverage identity pin", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("product_id-only Taster's Choice does not fetch or attach Turkish coffee peers", async () => {
    const tasters = primary({
      productId: "tasters",
      name: "נסקפה טייסטרס צ'ויס",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "coffee",
      classL3: "instant_coffee",
      sizeUnit: "g",
      sizeQty: 200,
    });
    const line = resolvedLine({
      productId: "tasters",
      name: tasters.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      candidates: [tasters],
      equivalents: undefined,
    });

    await enrichCommodityCoverage([{ productId: "tasters", packQty: 1 }], [line], ["store-1"]);

    // No peer SQL — confirmed SKU without free-text query pins identity.
    expect(query).not.toHaveBeenCalled();
    expect(line.equivalents).toBeUndefined();
    expect(line.intentMode).toBe("exact");
  });

  it("GTIN-only request does not gain class peers or substitute another product", async () => {
    const coke = primary({
      productId: "coke",
      name: "קוקה קולה 1.5 ל",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "soda",
      classL3: "cola",
      sizeUnit: "ml",
      sizeQty: 1500,
    });
    const line = resolvedLine({
      productId: "coke",
      name: coke.name,
      resolvedBy: "gtin",
      resolutionStatus: "resolved",
      candidates: [coke],
      equivalents: undefined,
    });

    await enrichCommodityCoverage([{ gtin: "7290000000001", packQty: 1 }], [line], ["store-1"]);

    expect(query).not.toHaveBeenCalled();
    expect(line.equivalents).toBeUndefined();
    expect(line.intentMode).toBe("exact");
  });

  it("product_id + query עגבניות still broadens to class peers", async () => {
    const tomatoA = primary({
      productId: "tomato-a",
      name: "עגבניות רשת א",
      classL3: "tomato",
      sizeUnit: "g",
      sizeQty: 1000,
    });
    const line = resolvedLine({
      productId: "tomato-a",
      name: tomatoA.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      candidates: [tomatoA],
    });

    query.mockResolvedValue({
      rows: [
        {
          product_id: "tomato-b",
          name: "עגבניות רשת ב",
          size_qty: 1000,
          size_unit: "g",
          chain_id: "chain-b",
        },
      ],
    });

    await enrichCommodityCoverage(
      [{ productId: "tomato-a", query: "עגבניות", packQty: 1 }],
      [line],
      ["store-1"],
    );

    expect(query).toHaveBeenCalledOnce();
    expect(line.equivalents?.map((c) => c.productId).sort()).toEqual(["tomato-a", "tomato-b"]);
  });

  it("representative confirmation (commodity override) keeps multi-chain pita peers", async () => {
    const pitaA = primary({
      productId: "pita-10",
      name: "פיתות עננים 10",
      productClass: "bakery",
      classL1: "bakery",
      classL2: "pita_flatbread",
      classL3: "pita",
      sizeUnit: "g",
      sizeQty: 1000,
      pieceCount: 10,
    });
    const line = resolvedLine({
      productId: "pita-10",
      name: pitaA.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      candidates: [pitaA],
    });
    query.mockResolvedValue({
      rows: [
        {
          product_id: "pita-b",
          name: "פיתות רשת ב",
          size_qty: 1000,
          size_unit: "g",
          piece_count: 10,
          chain_id: "chain-b",
        },
        {
          product_id: "pita-c",
          name: "פיתות רשת ג",
          size_qty: 1000,
          size_unit: "g",
          piece_count: 10,
          chain_id: "chain-c",
        },
      ],
    });

    await enrichCommodityCoverage(
      [
        {
          productId: "pita-10",
          query: "פיתות",
          amount: 20,
          unit: "יח",
          intentModeOverride: "commodity",
        },
      ],
      [line],
      ["store-1"],
    );

    const peerIds = new Set(line.equivalents?.map((c) => c.productId) ?? []);
    expect(peerIds.has("pita-10")).toBe(true);
    expect(peerIds.has("pita-b")).toBe(true);
    expect(peerIds.has("pita-c")).toBe(true);
  });

  it("Coke Zero pin never attaches regular Coke peers", async () => {
    const cokeZero = primary({
      productId: "coke-zero",
      name: "קוקה קולה זירו 1.5 ל",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "soft_drink",
      classL3: "cola",
      variant: "diet_zero",
      sizeUnit: "ml",
      sizeQty: 1500,
    });
    const line = resolvedLine({
      productId: "coke-zero",
      name: cokeZero.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      candidates: [cokeZero],
    });

    await enrichCommodityCoverage(
      [
        {
          productId: "coke-zero",
          query: "קולה זירו",
          packQty: 2,
          intentModeOverride: "exact",
        },
      ],
      [line],
      ["store-1"],
    );

    expect(query).not.toHaveBeenCalled();
    expect(line.equivalents).toBeUndefined();
  });

  it("preserves prepare-attached equivalents on product_id-only (no peer fetch)", async () => {
    const coke = primary({
      productId: "coke",
      name: "קוקה קולה 1.5 ל",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "soft_drink",
      classL3: "cola",
      sizeUnit: "ml",
      sizeQty: 1500,
    });
    const crystal = primary({
      productId: "crystal",
      name: "קריסטל קולה 1.5 ל",
      productClass: "beverage",
      classL1: "beverage",
      classL2: "soft_drink",
      classL3: "cola",
      sizeUnit: "ml",
      sizeQty: 1500,
    });
    const line = resolvedLine({
      productId: "coke",
      name: coke.name,
      resolvedBy: "product_id",
      candidates: [coke],
      equivalents: [coke, crystal],
    });

    await enrichCommodityCoverage([{ productId: "coke", packQty: 1 }], [line], ["store-1"]);

    expect(query).not.toHaveBeenCalled();
    expect(line.equivalents?.map((c) => c.productId)).toEqual(["coke", "crystal"]);
  });
});

describe("classifyBrandFamilyPeers / package form", () => {
  const tasters95 = primary({
    productId: "tasters-95",
    name: "נסקפה טייסטרס צ'ויס 95ג",
    productClass: "beverage",
    classL1: "beverage",
    classL2: "coffee",
    classL3: "instant_coffee",
    brandExtracted: "טייסטרס צ'ויס",
    sizeQty: 95,
    sizeUnit: "g",
  });

  it("auto-accepts same-brand compatible packs and alternatives for larger packs", () => {
    const { auto, alternatives } = classifyBrandFamilyPeers(
      "טייסטרס צ׳ויס",
      tasters95,
      [
        {
          product_id: "tasters-100",
          name: "נסקפה טייסטרס צ'ויס מקורי 100ג",
          size_qty: 100,
          size_unit: "g",
          piece_count: null,
          brand_extracted: "טייסטרס צ'ויס",
        },
        {
          product_id: "tasters-200",
          name: "נסקפה טייסטרס צ'ויס 200ג",
          size_qty: 200,
          size_unit: "g",
          piece_count: null,
          brand_extracted: "טייסטרס צ'ויס",
        },
        {
          product_id: "elite",
          name: "קפה נמס עלית 100ג",
          size_qty: 100,
          size_unit: "g",
          piece_count: null,
          brand_extracted: "עלית",
        },
        {
          product_id: "sachets",
          name: "טייסטרס צ'ויס 20 מנות",
          size_qty: 36,
          size_unit: "g",
          piece_count: 20,
          brand_extracted: "טייסטרס צ'ויס",
        },
      ],
    );
    expect(auto.map((r) => r.product_id)).toEqual(["tasters-100"]);
    expect(alternatives.map((r) => r.product_id)).toEqual(["tasters-200"]);
  });

  it("treats sachets/multipacks as a different form from jar packs", () => {
    expect(packageFormKind("טייסטרס צ'ויס 20 מנות", 20)).toBe("multipack");
    expect(packageFormKind("נסקפה טייסטרס צ'ויס 100ג", null)).toBe("standard");
    expect(
      packageFormsCompatible(
        { name: "נסקפה טייסטרס צ'ויס 100ג", pieceCount: null },
        { name: "טייסטרס צ'ויס 20 מנות", pieceCount: 20 },
      ),
    ).toBe(false);
  });

  it("brand_family enrich attaches auto peers and alternatives", async () => {
    query.mockResolvedValue({
      rows: [
        {
          product_id: "tasters-100",
          name: "נסקפה טייסטרס צ'ויס מקורי 100ג",
          size_qty: 100,
          size_unit: "g",
          piece_count: null,
          chain_id: "c1",
          min_price: 31.9,
          brand_extracted: "טייסטרס צ'ויס",
        },
        {
          product_id: "tasters-200",
          name: "נסקפה טייסטרס צ'ויס 200ג",
          size_qty: 200,
          size_unit: "g",
          piece_count: null,
          chain_id: "c1",
          min_price: 39.9,
          brand_extracted: "טייסטרס צ'ויס",
        },
      ],
    });

    const line = resolvedLine({
      productId: "tasters-95",
      name: tasters95.name,
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      candidates: [tasters95],
    });

    await enrichCommodityCoverage(
      [
        {
          productId: "tasters-95",
          query: "טייסטרס צ׳ויס",
          packQty: 1,
          intentModeOverride: "brand_family",
        },
      ],
      [line],
      ["store-1"],
    );

    expect(line.intentMode).toBe("brand_family");
    expect(line.equivalents?.map((c) => c.productId).sort()).toEqual([
      "tasters-100",
      "tasters-95",
    ]);
    expect(line.alternatives?.map((c) => c.productId)).toEqual(["tasters-200"]);
  });
});
