/**
 * The head noun decides what a product IS.
 *
 * Two live-basket failures motivated these cases:
 *
 *   "נייר טואלט"   returned "מחזיק נייר טואלט" (a toilet-roll HOLDER). The
 *                  shopper wanted paper and would have gone home with a bracket.
 *   "קורנפלייקס"   was refused "קורנפלקס 500 גרם", the same product, because the
 *                  two spellings differ by two yods.
 *
 * The mechanism was already right in both cases. It was missing one word of
 * vocabulary, and it compared spellings too literally for a language that writes
 * the same word several ways.
 */
import { describe, expect, it } from "vitest";
import { queryHeadAnchored } from "../../../src/services/basket/equivalence.js";

describe("head anchoring rejects accessories, not the product", () => {
  it("rejects a holder when the shopper asked for what it holds", () => {
    expect(queryHeadAnchored("נייר טואלט", "מחזיק נייר טואלט ואק")).toBe(false);
    expect(queryHeadAnchored('סכו"ם', "מעמד סכום")).toBe(false);
  });

  it("keeps the actual product", () => {
    expect(queryHeadAnchored("נייר טואלט", 'נייר טואלט "לילי" לב')).toBe(true);
    expect(queryHeadAnchored("נייר טואלט", "נייר טואלט דו שכבתי 32 גלילים")).toBe(true);
  });

  it("still catches the traps it caught before", () => {
    // Guards against the vocabulary addition loosening anything.
    expect(queryHeadAnchored("יין", "חולץ פקקים יין")).toBe(false);
    expect(queryHeadAnchored("אורז", "פתיתים אורז")).toBe(false);
    expect(queryHeadAnchored("מים", "אקדח מים DC")).toBe(false);
    expect(queryHeadAnchored("חלב", "חלב תנובה 3%")).toBe(true);
  });
});

describe("head anchoring tolerates Hebrew spelling variants", () => {
  it("matches ktiv male against ktiv haser both ways", () => {
    expect(queryHeadAnchored("קורנפלייקס", "קורנפלקס 500 גרם")).toBe(true);
    expect(queryHeadAnchored("קורנפלקס", "קורנפלייקס תלמה 750 גרם")).toBe(true);
  });

  it("does NOT collapse short words where those letters carry the meaning", () => {
    // שמן is oil, שומן is fat. Folding every yod and vav would make a request for
    // cooking oil match hardened fat, which is worse than the bug being fixed.
    expect(queryHeadAnchored("שמן", "שומן מוקשה 500 גרם")).toBe(false);
  });

  it("leaves an ordinary head match alone", () => {
    expect(queryHeadAnchored("גבינה", "גבינה צהובה עמק")).toBe(true);
    expect(queryHeadAnchored("לחם", "לחם אחיד פרוס")).toBe(true);
  });
});
