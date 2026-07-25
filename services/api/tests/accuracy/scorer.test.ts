import { describe, expect, it } from "vitest";
import {
  aggregate,
  byCategory,
  evaluateAccept,
  findRegressions,
  scoreBasket,
  type ProductFacts,
  type ScorableBasket,
} from "../../src/scripts/accuracy/scorer.js";
import {
  BENCHMARK_BASKETS,
  LABELS_BY_ID,
  STAPLE_LABELS,
} from "../../src/scripts/accuracy/labels/staples.js";
import type { BasketScore, StapleLabel } from "../../src/scripts/accuracy/types.js";

/**
 * Tests the SCORER, not the system's accuracy. A benchmark whose own scorer is
 * unverified is just a differently-shaped guess, which is the failure mode this
 * whole harness exists to close.
 */

const facts = (over: Partial<ProductFacts> = {}): ProductFacts => ({
  classL2: "grains_rice",
  preparation: "plain",
  nearbyStores: 200,
  ...over,
});

describe("evaluateAccept", () => {
  it("accepts a correct resolution", () => {
    expect(
      evaluateAccept(
        { requireTokens: ["אורז"], forbidTokens: ["דפי"], anyOfClassL2: ["grains_rice"] },
        'אורז לבן עגול 1 ק"ג',
        facts(),
      ),
    ).toEqual([]);
  });

  it("rejects the rice-paper case that motivated the benchmark", () => {
    const failures = evaluateAccept(
      {
        requireTokens: ["אורז"],
        forbidTokens: ["דפי", "מקלוני"],
        anyOfPreparation: ["plain"],
      },
      'דפי אורז עגול 22 ס"מ',
      facts({ preparation: "derived_ingredient" }),
    );
    expect(failures).toHaveLength(2);
    expect(failures.join(" ")).toContain("דפי");
    expect(failures.join(" ")).toContain("derived_ingredient");
  });

  it("separates a forbidden word from a brand that contains it", () => {
    // עץ הזית is a CANOLA brand, so a plain forbidTokens:["זית"] scored 11 correct
    // resolutions as wrong. The pattern must pass the brand and still catch the
    // irregular olive-oil spellings a "שמן זית" phrase would have let through.
    const accept = { requireTokens: ["שמן"], forbidPatterns: ["(?<!עץ ה)זית"] };
    for (const canola of [
      'שמן קנולה עץ הזית סוגת 750 מ"ל',
      "שמן עץ הזית חמניות 1 ליטר בריאות מהטבע",
      "שמן זרעי ענבים 1 ליטר עץ הזית",
    ]) {
      expect(evaluateAccept(accept, canola, facts()), canola).toEqual([]);
    }
    for (const olive of ['שמן  זית 750 מ"ל', 'שמןזית כתית מעולה 750מ"ל', "ש.זית צור יצחק כתית"]) {
      expect(evaluateAccept(accept, olive, facts()), olive).not.toEqual([]);
    }
  });

  it("treats an unresolved line as a single failure", () => {
    expect(evaluateAccept({ requireTokens: ["אורז"] }, null, undefined)).toEqual(["unresolved"]);
  });

  it("requires every requireTokens entry but only one requireAnyToken entry", () => {
    expect(evaluateAccept({ requireTokens: ["גבינה", "צהובה"] }, "גבינה לבנה", facts())).toHaveLength(1);
    expect(evaluateAccept({ requireAnyToken: ["פסטה", "ספגטי"] }, "ספגטי מספר 8", facts())).toEqual([]);
    expect(evaluateAccept({ requireAnyToken: ["פסטה", "ספגטי"] }, "אורז לבן", facts())).toHaveLength(1);
  });

  it("flags a name-perfect match that almost nobody stocks", () => {
    const failures = evaluateAccept(
      { requireTokens: ["חמאה"], minNearbyStoreShare: 0.3 },
      "חמאה לה גאל פרימיום",
      facts({ classL2: "butter_cream", nearbyStores: 2 }),
      143,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("2/143");
  });

  /**
   * The threshold is a share because the denominator moves: 143 branches within
   * 10km of Herzliya against 898 nationally. The first run of this harness used
   * absolute counts calibrated on national numbers and false-failed correct answers.
   */
  it("passes the same store count when the scope is smaller", () => {
    const accept = { requireTokens: ["חמאה"], minNearbyStoreShare: 0.3 };
    // 50/143 = 35% clears a 30% bar; 50/890 = 6% does not.
    const f = facts({ classL2: "butter_cream", nearbyStores: 50 });
    expect(evaluateAccept(accept, "חמאה תנובה", f, 143)).toEqual([]);
    expect(evaluateAccept(accept, "חמאה תנובה", f, 890)).toHaveLength(1);
  });

  it("skips the share test when the denominator is unknown", () => {
    expect(
      evaluateAccept({ minNearbyStoreShare: 0.9 }, "חמאה", facts({ nearbyStores: 1 }), null),
    ).toEqual([]);
  });

  /**
   * An unclassified catalog must not score as wrong, or the benchmark punishes the
   * very gap it exists to measure: 95,974 of 118,156 stocked products have no l3,
   * and `preparation` starts life entirely NULL.
   */
  it("does not penalise a product whose facts are unknown", () => {
    expect(
      evaluateAccept(
        { requireTokens: ["אורז"], anyOfClassL2: ["grains_rice"], anyOfPreparation: ["plain"], minNearbyStoreShare: 0.9 },
        "אורז לבן",
        { classL2: null, preparation: null, nearbyStores: null },
        143,
      ),
    ).toEqual([]);
    expect(evaluateAccept({ anyOfClassL2: ["grains_rice"] }, "אורז לבן", undefined)).toEqual([]);
  });
});

const label = (id: string, over: Partial<StapleLabel> = {}): StapleLabel => ({
  id,
  query: id,
  category: "test",
  accept: { requireTokens: [id] },
  notes: "fixture",
  confidence: "high",
  ...over,
});

function response(over: Partial<ScorableBasket> = {}): ScorableBasket {
  return {
    items: [
      { index: 0, productId: "p0", name: "good", resolutionStatus: "resolved" },
      { index: 1, productId: "p1", name: "bad", resolutionStatus: "resolved" },
    ],
    bestSingleStore: {
      storeName: "Store",
      comparableTotal: 100,
      imputedLines: 1,
      lines: [{ itemIndex: 0, clubOnly: false, couponOnly: true }],
    },
    ...over,
  };
}

describe("scoreBasket", () => {
  const labels = [label("good"), label("bad", { accept: { requireTokens: ["expected"] } })];

  it("scores a known-good and known-bad fixture", () => {
    const score = scoreBasket({
      basketId: "b",
      name: "b",
      labels,
      response: response(),
      facts: () => undefined,
      elapsedMs: 5,
    });
    expect(score.acceptedLines).toBe(1);
    expect(score.requestedLines).toBe(2);
    expect(score.pricedLines).toBe(1);
    expect(score.couponOnlyLines).toBe(1);
    expect(score.imputedLines).toBe(1);
    expect(score.lines[1]?.failures[0]).toContain("expected");
  });

  it("counts an unpriced line as resolved-but-not-priced", () => {
    const score = scoreBasket({
      basketId: "b",
      name: "b",
      labels: [label("good")],
      response: response({ bestSingleStore: { storeName: "S", comparableTotal: 1, imputedLines: 0, lines: [] } }),
      facts: () => undefined,
      elapsedMs: 1,
    });
    expect(score.acceptedLines).toBe(1);
    expect(score.pricedLines).toBe(0);
  });

  it("survives a null plan without throwing", () => {
    const score = scoreBasket({
      basketId: "b",
      name: "b",
      labels: [label("good")],
      response: response({ bestSingleStore: null }),
      facts: () => undefined,
      elapsedMs: 1,
    });
    expect(score.pricedLines).toBe(0);
    expect(score.comparableTotal).toBeNull();
  });
});

describe("aggregate and byCategory", () => {
  it("computes the four metrics over scored baskets", () => {
    const score = scoreBasket({
      basketId: "b",
      name: "b",
      labels: [label("good"), label("bad", { accept: { requireTokens: ["nope"] } })],
      response: response(),
      facts: () => undefined,
      elapsedMs: 1,
    });
    const m = aggregate([score]);
    expect(m.resolutionAccuracy).toBe(0.5);
    expect(m.coverage).toBe(0.5);
    expect(m.conditionalExposure).toBe(1);
    expect(m.imputedShare).toBe(1);
  });

  it("ignores errored baskets rather than scoring them as zero", () => {
    const errored = {
      basketId: "e", name: "e", requestedLines: 5, acceptedLines: 0, pricedLines: 0,
      clubOnlyLines: 0, couponOnlyLines: 0, imputedLines: 0, comparableTotal: null,
      storeName: null, elapsedMs: 0, lines: [], error: "boom",
    };
    expect(aggregate([errored]).resolutionAccuracy).toBe(0);
    expect(aggregate([errored]).coverage).toBe(0);
  });

  it("groups accuracy by category", () => {
    const score = scoreBasket({
      basketId: "b",
      name: "b",
      labels: [label("good", { category: "milk" }), label("bad", { category: "milk", accept: { requireTokens: ["nope"] } })],
      response: response(),
      facts: () => undefined,
      elapsedMs: 1,
    });
    expect(byCategory([score]).milk).toEqual({ total: 2, accepted: 1, accuracy: 0.5 });
  });
});

describe("findRegressions", () => {
  const base = { resolutionAccuracy: 0.8, coverage: 0.9, conditionalExposure: 0.1, imputedShare: 0.1 };

  it("flags a drop beyond tolerance", () => {
    const found = findRegressions({ ...base, resolutionAccuracy: 0.7 }, base, 0.02);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("resolutionAccuracy");
  });

  it("tolerates noise and improvements", () => {
    expect(findRegressions({ ...base, resolutionAccuracy: 0.79 }, base, 0.02)).toEqual([]);
    expect(findRegressions({ ...base, resolutionAccuracy: 0.95 }, base, 0.02)).toEqual([]);
  });

  /** These describe the catalog and promo landscape, so a data refresh must not fail a build. */
  it("does not gate on conditionalExposure or imputedShare", () => {
    expect(findRegressions({ ...base, conditionalExposure: 0.9, imputedShare: 0.9 }, base, 0.02)).toEqual([]);
  });
});

describe("label set integrity", () => {
  it("has unique ids", () => {
    const ids = STAPLE_LABELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every basket references a known label", () => {
    for (const basket of BENCHMARK_BASKETS) {
      for (const id of basket.labelIds) {
        expect(LABELS_BY_ID.has(id), `${basket.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("every label states at least one positive and is documented", () => {
    for (const l of STAPLE_LABELS) {
      const positive =
        (l.accept.requireTokens?.length ?? 0) > 0 || (l.accept.requireAnyToken?.length ?? 0) > 0;
      expect(positive, `${l.id} has no positive criterion`).toBe(true);
      expect(l.notes.length, `${l.id} has no notes`).toBeGreaterThan(10);
    }
  });

  /** A requireTokens set that can never be satisfied together is a broken label. */
  it("has no label requiring two mutually exclusive tokens", () => {
    for (const l of STAPLE_LABELS) {
      for (const req of l.accept.requireTokens ?? []) {
        expect(l.accept.forbidTokens ?? [], `${l.id} forbids its own required token`).not.toContain(req);
      }
    }
  });

  /**
   * An invalid forbidPatterns regex throws out of evaluateAccept and is caught only
   * by the CLI's top-level handler, so it aborts the WHOLE benchmark rather than
   * failing one label. Catch it here, where the cost is a red test.
   */
  it("every forbidPattern compiles, and forbids nothing a label requires", () => {
    for (const l of STAPLE_LABELS) {
      for (const pattern of l.accept.forbidPatterns ?? []) {
        expect(() => new RegExp(pattern), `${l.id} has an invalid forbidPattern`).not.toThrow();
        const re = new RegExp(pattern);
        for (const req of [...(l.accept.requireTokens ?? []), ...(l.accept.requireAnyToken ?? [])]) {
          expect(re.test(req), `${l.id} forbidPattern ${pattern} rejects its own token ${req}`).toBe(
            false,
          );
        }
      }
    }
  });
});

/**
 * A crash must lower the score, never shrink the denominator. Dropping failed
 * baskets from both sides once made two runs look 4 points apart when they differed
 * by a single line, because one 9-line basket had errored.
 */
describe("aggregate counts failed baskets against the score", () => {
  const ok = (id: string, requested: number, accepted: number, priced: number): BasketScore =>
    ({
      basketId: id,
      name: id,
      requestedLines: requested,
      acceptedLines: accepted,
      pricedLines: priced,
      clubOnlyLines: 0,
      couponOnlyLines: 0,
      imputedLines: 0,
      comparableTotal: 100,
      storeName: "s",
      elapsedMs: 1,
      lines: [],
    }) as unknown as BasketScore;

  it("keeps a failed basket's lines in the denominator", () => {
    const healthy = ok("a", 10, 10, 10);
    const broken = { ...ok("b", 10, 0, 0), error: "boom" } as unknown as BasketScore;
    const m = aggregate([healthy, broken]);
    expect(m.requestedLines).toBe(20);
    expect(m.erroredBaskets).toBe(1);
    // 10 accepted of 20 requested, not 10 of 10.
    expect(m.resolutionAccuracy).toBe(0.5);
    expect(m.coverage).toBe(0.5);
  });

  it("reports a clean run at full marks with no errors", () => {
    const m = aggregate([ok("a", 10, 10, 10), ok("b", 5, 5, 5)]);
    expect(m.requestedLines).toBe(15);
    expect(m.erroredBaskets).toBe(0);
    expect(m.resolutionAccuracy).toBe(1);
  });
});
