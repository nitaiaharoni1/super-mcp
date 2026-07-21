import { describe, expect, it } from "vitest";
import {
  buildAvailabilityEquivalents,
  buildCommodityEquivalents,
  preferQueryHeadAnchored,
  queryHeadAnchored,
  queryTokensSatisfied,
  variantConflict,
} from "../../../src/services/basket/equivalence.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

describe("queryHeadAnchored", () => {
  it("blocks a query word that is a trailing MODIFIER (חלב → milk frother)", () => {
    expect(queryHeadAnchored("חלב", "בריסטה מקציף חלב")).toBe(false);
  });
  it("passes when the query head leads the name (חומוס)", () => {
    expect(queryHeadAnchored("חומוס", "חומוס גדול שופרסל 1 ק\"ג")).toBe(true);
  });
  it("passes brand-led names (one leading brand token allowed)", () => {
    expect(queryHeadAnchored("חלב", "תנובה חלב 3%")).toBe(true);
    expect(queryHeadAnchored("פרגיות עוף", "סטייק פרגיות עוף טרי")).toBe(true);
  });
  it("is plural/singular tolerant on the head", () => {
    expect(queryHeadAnchored("עגבניות", "עגבניה חממה")).toBe(true);
  });
  it("blocks a utensil/container/toy leader (pasta spoon, water gun)", () => {
    expect(queryHeadAnchored("פסטה", "כף פסטה")).toBe(false);
    expect(queryHeadAnchored("מים", "אקדח מים")).toBe(false);
    expect(queryHeadAnchored("נייר טואלט", "אחסונית נייר טואלט")).toBe(false);
  });
  it("blocks wine openers for bare wine queries", () => {
    expect(queryHeadAnchored("יין", "חולץ יין")).toBe(false);
    expect(queryHeadAnchored("יין", "פותחן יין מלצרים")).toBe(false);
    expect(queryHeadAnchored("יין אדום", "יין קברנה סוביניון")).toBe(true);
  });
  it("preferQueryHeadAnchored puts bottles before corkscrews", () => {
    const ordered = preferQueryHeadAnchored("יין", [
      { name: "חולץ יין", id: "c" },
      { name: "יין אדום מונטפולציאנו", id: "w" },
      { name: "פותחן יין", id: "o" },
    ]);
    expect(ordered.map((x) => x.id)).toEqual(["w", "c", "o"]);
  });
  it("blocks a derived-product leader (apple vinegar, orange juice)", () => {
    expect(queryHeadAnchored("תפוחים", "חומץ תפוחים אולד דאט")).toBe(false);
    expect(queryHeadAnchored("תפוזים", "מיץ תפוזים סחוט")).toBe(false);
  });
  it("blocks prepared-food / dessert hosts for produce and cola queries", () => {
    expect(queryHeadAnchored("לימונים", "עוגת לימונים 600 גרם")).toBe(false);
    expect(queryHeadAnchored("לימונים", "עוגות לימון")).toBe(false);
    expect(queryHeadAnchored("קולה", "לקריץ קולה מסוכר במשקל")).toBe(false);
    expect(queryHeadAnchored("לימונים", "ליקר לימון")).toBe(false);
  });
  it("still passes a genuine brand/cut leader", () => {
    expect(queryHeadAnchored("חלב", "תנובה חלב 3%")).toBe(true);
    expect(queryHeadAnchored("פרגיות עוף", "סטייק פרגיות עוף טרי")).toBe(true);
  });
  it("blocks stuffed-dough hosts (dumplings/ravioli/burekas) for the filling query", () => {
    expect(queryHeadAnchored("בשר", "כיסונים בשר בקר 800 גרם מאמא מרי")).toBe(false);
    expect(queryHeadAnchored("בשר בקר", "כיסונים בשר בקר בסגנון")).toBe(false);
  });
  it("still anchors a real burekas query and legit raw beef", () => {
    // leader guard fires only when the host word is NOT the query head
    expect(queryHeadAnchored("בורקס", "בורקס גבינה")).toBe(true);
    expect(queryHeadAnchored("בשר בקר", "בשר בקר טחון טרי")).toBe(true);
  });
  it("blocks rice-shaped pasta hosts for bare אורז", () => {
    expect(queryHeadAnchored("אורז", "פתיתים אורז רמי לוי 500 גרם")).toBe(false);
    expect(queryHeadAnchored("אורז", "אורז בסמטי סוגת 1 קג")).toBe(true);
  });
});

describe("queryTokensSatisfied (morphology-tolerant)", () => {
  it("matches Hebrew plural query against singular name and vice versa", () => {
    expect(queryTokensSatisfied(["מלפפונים"], "מלפפון ארוז")).toBe(true);
    expect(queryTokensSatisfied(["עגבניות"], "עגבניה חממה")).toBe(true);
  });
  it("matches short pita plurals (פיתות↔פיתה)", () => {
    expect(queryTokensSatisfied(["פיתות"], "פיתה אסלי")).toBe(true);
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
    pieceCount: null,
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
    pieceCount: null,
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

  it("excludes organ/processed chicken peers for bare עוף", () => {
    const meat = (name: string): BasketCandidate =>
      c({
        name,
        productClass: "meat_chicken",
        classL1: "meat",
        classL2: "chicken",
        sizeQty: null,
        sizeUnit: null,
      });
    const top = meat("חזה עוף טרי");
    const set = buildCommodityEquivalents(
      top,
      [
        top,
        meat("כבד עוף טרי - כשר"),
        meat("עוף טוב אצבעות שניצל"),
        meat("שוק עוף טרי"),
      ],
      "עוף",
      5,
    );
    expect(set.map((x) => x.name).sort()).toEqual(["חזה עוף טרי", "שוק עוף טרי"]);
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

  it("bare יין includes red/white/rosé peers under the wine family", () => {
    const wine = (
      name: string,
      classL3: "red_wine" | "white_wine" | "rose_wine",
    ): BasketCandidate =>
      c({
        name,
        productClass: "alcohol",
        classL1: "alcohol",
        classL2: "wine",
        classL3,
        sizeUnit: "ml",
        sizeQty: 750,
        variant: "regular",
      });
    const top = wine("יין אדום קברנה", "red_wine");
    const set = buildCommodityEquivalents(
      top,
      [
        top,
        wine("יין לבן יקבי רמת הגולן", "white_wine"),
        wine("יין רוזה יבש", "rose_wine"),
        wine("חולץ יין", "red_wine"),
      ],
      "יין",
      5,
    );
    expect(set.map((x) => x.name).sort()).toEqual([
      "יין אדום קברנה",
      "יין לבן יקבי רמת הגולן",
      "יין רוזה יבש",
    ]);
  });

  it("יין אדום excludes white/rosé even when they share the wine L2", () => {
    const wine = (
      name: string,
      classL3: "red_wine" | "white_wine" | "rose_wine",
    ): BasketCandidate =>
      c({
        name,
        productClass: "alcohol",
        classL1: "alcohol",
        classL2: "wine",
        classL3,
        sizeUnit: "ml",
        sizeQty: 750,
        variant: "regular",
      });
    const top = wine("יין אדום קברנה", "red_wine");
    const set = buildCommodityEquivalents(
      top,
      [top, wine("יין לבן יבש", "white_wine"), wine("יין אדום מרלו", "red_wine")],
      "יין אדום",
      5,
    );
    expect(set.map((x) => x.name)).toEqual(["יין אדום קברנה", "יין אדום מרלו"]);
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

  it("groups kg↔g produce peers (canonical weight)", () => {
    const top = c({ sizeUnit: "kg", sizeQty: 1 });
    const peer = c({ sizeUnit: "g", sizeQty: 1000 });
    const set = buildCommodityEquivalents(top, [top, peer], "עגבניות", 5);
    expect(set).toHaveLength(2);
  });

  it("groups unit↔g produce peers; still excludes a different class", () => {
    const top = c({ classL1: "produce" });
    const unitPeer = c({ sizeUnit: "unit", sizeQty: 1, classL1: "produce" });
    const canned = c({ productClass: "canned", classL1: "pantry" });
    const set = buildCommodityEquivalents(top, [top, unitPeer, canned], "עגבניות", 5);
    expect(set).toHaveLength(2);
    expect(set.map((x) => x.productClass)).not.toContain("canned");
  });

  it("returns only the top pick when it has no product class", () => {
    const top = c({ productClass: null });
    expect(buildCommodityEquivalents(top, [top, c({ productClass: null })], "עגבניות", 5)).toEqual([
      top,
    ]);
  });

  it("excludes crushed/canned tomato and potato flour/gnocchi traps from fresh produce sets", () => {
    const top = c({ name: "עגבניות חממה" });
    const tomatoSet = buildCommodityEquivalents(
      top,
      [top, c({ name: "עגבניות מרוסקות 850 גרם" }), c({ name: "עגבניות שרי" })],
      "עגבניות",
      5,
    );
    const names = tomatoSet.map((x) => x.name);
    expect(names).not.toContain("עגבניות מרוסקות 850 גרם");
    expect(names).toContain("עגבניות שרי");

    const potatoTop = c({ name: "תפוחי אדמה ארוזים", productClass: "produce" });
    const potatoSet = buildCommodityEquivalents(
      potatoTop,
      [
        potatoTop,
        c({ name: "קמח תפוחי אדמה 500 גרם" }),
        c({ name: "ניוקי תפוחי אדמה" }),
        c({ name: "תפוחי אדמה אדומים" }),
      ],
      "תפוחי אדמה",
      5,
    );
    const potatoNames = potatoSet.map((x) => x.name);
    expect(potatoNames).not.toContain("קמח תפוחי אדמה 500 גרם");
    expect(potatoNames).not.toContain("ניוקי תפוחי אדמה");
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
    pieceCount: null,
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

  it("excludes prepared-food hosts that share a produce token (lemon cake)", () => {
    const freshA = h({ name: "לימון טרי", sizeUnit: "kg", sizeQty: 1 });
    const freshB = h({ name: "לימונים ארוזים", sizeUnit: "kg", sizeQty: 1 });
    const cake = h({ name: "עוגת לימונים 600 גרם", sizeUnit: "g", sizeQty: 600 });
    const set = buildAvailabilityEquivalents([cake, freshA, freshB], "לימונים", opts);
    expect(set.map((x) => x.name)).not.toContain("עוגת לימונים 600 גרם");
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
