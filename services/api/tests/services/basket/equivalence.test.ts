import { describe, expect, it } from "vitest";
import {
  buildAvailabilityEquivalents,
  buildCommodityEquivalents,
  queryTokensSatisfied,
  variantConflict,
} from "../../../src/services/basket/equivalence.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

describe("queryTokensSatisfied (morphology-tolerant)", () => {
  it("matches Hebrew plural query against singular name and vice versa", () => {
    expect(queryTokensSatisfied(["מלפפונים"], "מלפפון ארוז")).toBe(true);
    expect(queryTokensSatisfied(["עגבניות"], "עגבניה חממה")).toBe(true);
  });
  it("still requires a specific token (cabernet) to be present", () => {
    expect(queryTokensSatisfied(["יין", "אדום", "קברנה"], "יין אדום מרלו")).toBe(false);
    expect(queryTokensSatisfied(["יין", "אדום", "קברנה"], "יין אדום קברנה סוביניון")).toBe(true);
  });
  it("does not over-match unrelated tokens beyond the 3-char suffix window", () => {
    expect(queryTokensSatisfied(["בצל"], "בצלצלים ממותקים בקרמל")).toBe(false); // +5 chars
  });
});

describe("variantConflict", () => {
  const v = (variant: string | null): BasketCandidate => ({
    productId: crypto.randomUUID(),
    name: "x",
    score: 1,
    matchedVia: "product",
    sizeQty: null,
    sizeUnit: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: null,
    variant,
  });
  it("conflicts when both labeled and differ (regular vs diet_zero)", () => {
    expect(variantConflict(v("regular"), v("diet_zero"))).toBe(true);
  });
  it("no conflict for same variant", () => {
    expect(variantConflict(v("regular"), v("regular"))).toBe(false);
  });
  it("no conflict when either variant is unknown", () => {
    expect(variantConflict(v(null), v("cherry_grape"))).toBe(false);
  });
});

describe("buildCommodityEquivalents", () => {
  const c = (over: Partial<BasketCandidate>): BasketCandidate => ({
    productId: crypto.randomUUID(),
    name: "עגבניות",
    score: 0.9,
    matchedVia: "product",
    sizeQty: 1000,
    sizeUnit: "g",
    hasPrice: true,
    hasLocalPrice: true,
    productClass: "produce",
    intentTier: null, // fragmented produce SKUs are tier-null yet fungible
    ...over,
  });

  it("groups fragmented per-chain produce SKUs even when intentTier is null", () => {
    const top = c({});
    const set = buildCommodityEquivalents(top, [top, c({}), c({})], "עגבניות", 5);
    expect(set).toHaveLength(3);
  });

  it("groups every red wine for a generic query so the cheapest can win", () => {
    const wine = (name: string) =>
      c({ name, productClass: "beverage", sizeUnit: "ml", sizeQty: 750 });
    const top = wine("יין אדום אמרונה קורט");
    const set = buildCommodityEquivalents(
      top,
      [top, wine("יין אדום מרלו"), wine("יין אדום קברנה סוביניון")],
      "יין אדום",
      5,
    );
    expect(set).toHaveLength(3); // all red wines are interchangeable when unspecified
  });

  it("respects query specificity: 'יין אדום קברנה' excludes non-cabernet wines", () => {
    const wine = (name: string) =>
      c({ name, productClass: "beverage", sizeUnit: "ml", sizeQty: 750 });
    const top = wine("יין אדום קברנה סוביניון גדׂו");
    const set = buildCommodityEquivalents(
      top,
      [top, wine("יין אדום קברנה רקנאטי"), wine("יין אדום מרלו")],
      "יין אדום קברנה",
      5,
    );
    expect(set.map((x) => x.name)).not.toContain("יין אדום מרלו");
    expect(set).toHaveLength(2);
  });

  it("excludes a bulk size beyond pack tolerance (2L wine vs 750ml)", () => {
    const wine = (name: string, sizeQty: number) =>
      c({ name, productClass: "beverage", sizeUnit: "ml", sizeQty });
    const top = wine("יין אדום קורט", 750);
    const set = buildCommodityEquivalents(top, [top, wine("יין אדום ביתי", 2000)], "יין אדום", 5);
    expect(set).toHaveLength(1);
  });

  it("excludes a different unit and a different class", () => {
    const top = c({});
    const set = buildCommodityEquivalents(
      top,
      [top, c({ sizeUnit: "unit" }), c({ productClass: "canned" })],
      "עגבניות",
      5,
    );
    expect(set).toHaveLength(1);
  });

  it("returns only the top pick when it has no product class", () => {
    const top = c({ productClass: null });
    expect(buildCommodityEquivalents(top, [top, c({ productClass: null })], "עגבניות", 5)).toEqual([
      top,
    ]);
  });
});

describe("buildAvailabilityEquivalents", () => {
  // Unclassified commodity SKUs (the real-world default): productClass null,
  // intentTier tier-1, locally available. Availability + query tokens must carry
  // the resolution when there is NO class signal.
  const h = (over: Partial<BasketCandidate>): BasketCandidate => ({
    productId: crypto.randomUUID(),
    name: "חומוס אסלי 700 גרם",
    score: 0.9,
    matchedVia: "product",
    sizeQty: 700,
    sizeUnit: "g",
    hasPrice: true,
    hasLocalPrice: true,
    productClass: null,
    intentTier: 1,
    ...over,
  });
  const opts = {
    maxEquivalents: 5,
    packTolerance: 0.5,
    penaltyBlock: 1,
    penaltyOf: () => 0,
  };

  it("auto-resolves an unclassified staple: ≥2 local, query-safe, same-unit SKUs group", () => {
    const set = buildAvailabilityEquivalents(
      [h({ name: "חומוס אסלי 700 גרם" }), h({ name: "חומוס מסעדות צבר 700 גרם" })],
      "חומוס",
      opts,
    );
    expect(set).toHaveLength(2);
  });

  it("excludes candidates with no local price (availability is required)", () => {
    const local = h({ name: "חומוס אסלי" });
    const set = buildAvailabilityEquivalents(
      [local, h({ name: "חומוס מסעדות", hasLocalPrice: false })],
      "חומוס",
      opts,
    );
    // only one locally-available member → below the ≥2 commodity signal → []
    expect(set).toEqual([]);
  });

  it("excludes gate-penalized variants (diet cola never joins a bare-cola set)", () => {
    const regularA = h({ productId: "reg-a", name: "קוקה קולה", sizeUnit: "ml", sizeQty: 1500 });
    const regularB = h({ productId: "reg-b", name: "קוקה קולה 1.5 ליטר", sizeUnit: "ml", sizeQty: 1500 });
    const diet = h({ productId: "diet", name: "קוקה קולה דיאט", sizeUnit: "ml", sizeQty: 1500 });
    const set = buildAvailabilityEquivalents([diet, regularA, regularB], "קוקה קולה", {
      ...opts,
      penaltyOf: (id) => (id === "diet" ? 2 : 0),
    });
    expect(set.map((x) => x.productId)).not.toContain("diet");
    expect(set).toHaveLength(2);
  });

  it("respects query specificity: a token not in the name excludes the candidate", () => {
    // 'שקית קרח' must NOT group ice-snacks whose name lacks 'שקית'.
    const bagA = h({ name: "שקית קרח 2 קג", sizeUnit: "g", sizeQty: 2000 });
    const bagB = h({ name: "שקית קרח מהודר", sizeUnit: "g", sizeQty: 2000 });
    const snack = h({ name: "חטיפי קרח ללא חומרים", sizeUnit: "g", sizeQty: 2000 });
    const set = buildAvailabilityEquivalents([bagA, bagB, snack], "שקית קרח", opts);
    expect(set.map((x) => x.name)).not.toContain("חטיפי קרח ללא חומרים");
    expect(set).toHaveLength(2);
  });

  it("excludes a different unit from the group", () => {
    const perKg = h({ name: "מלח גס 1 קג", sizeUnit: "g", sizeQty: 1000 });
    const perKg2 = h({ name: "מלח גס אטלנטי", sizeUnit: "g", sizeQty: 1000 });
    const perUnit = h({ name: "מלח גס יחידה", sizeUnit: "unit", sizeQty: 1 });
    const set = buildAvailabilityEquivalents([perKg, perKg2, perUnit], "מלח גס", opts);
    expect(set.map((x) => x.sizeUnit)).not.toContain("unit");
    expect(set).toHaveLength(2);
  });

  it("does not disagree on product_class when both members are classified", () => {
    const produce = h({ name: "פלפל אדום", productClass: "produce", sizeUnit: "g", sizeQty: 1000 });
    const spice = h({ name: "פלפל שחור טחון", productClass: "spice", sizeUnit: "g", sizeQty: 1000 });
    const produce2 = h({ name: "פלפל אדום קלוף", productClass: "produce", sizeUnit: "g", sizeQty: 1000 });
    const set = buildAvailabilityEquivalents([produce, spice, produce2], "פלפל", opts);
    expect(set.map((x) => x.productClass)).not.toContain("spice");
    expect(set).toHaveLength(2);
  });

  it("excludes gate-rejected tier-0 candidates", () => {
    const ok1 = h({ name: "אבטיח" });
    const ok2 = h({ name: "אבטיח אדום" });
    const rejected = h({ name: "אבטיח", intentTier: 0 });
    const set = buildAvailabilityEquivalents([ok1, ok2, rejected], "אבטיח", opts);
    expect(set).toHaveLength(2);
  });

  it("returns [] when fewer than two members qualify (no false commodity)", () => {
    const one = h({ name: "חומוס אסלי" });
    expect(buildAvailabilityEquivalents([one], "חומוס", opts)).toEqual([]);
  });

  it("returns [] on an empty query (no tokens to anchor specificity)", () => {
    expect(buildAvailabilityEquivalents([h({}), h({})], "", opts)).toEqual([]);
  });

  it("excludes an unrequested pickled form (fresh cucumber never groups a pickled jar)", () => {
    const freshA = h({ name: "מלפפונים", sizeUnit: "kg", sizeQty: 1000 });
    const freshB = h({ name: "מלפפונים ארוזים", sizeUnit: "kg", sizeQty: 1000 });
    const pickled = h({ name: "מלפפונים בייבי כבושי", sizeUnit: "kg", sizeQty: 1000 });
    const set = buildAvailabilityEquivalents([freshA, freshB, pickled], "מלפפונים", opts);
    expect(set.map((x) => x.name)).not.toContain("מלפפונים בייבי כבושי");
    expect(set).toHaveLength(2);
  });

  it("keeps a preserved form when the query explicitly asks for it", () => {
    const pickledA = h({ name: "מלפפונים חמוצים", sizeUnit: "kg", sizeQty: 1000 });
    const pickledB = h({ name: "מלפפונים חמוצים בצנצנת", sizeUnit: "kg", sizeQty: 1000 });
    const set = buildAvailabilityEquivalents([pickledA, pickledB], "מלפפונים חמוצים", opts);
    expect(set).toHaveLength(2);
  });
});
