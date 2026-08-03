import { describe, expect, it } from "vitest";
import {
  expandHebrewQueryVariants,
  hebrewSingularVariants,
  queryTokensSatisfied,
  stemHebrewToken,
} from "../../src/intent/hebrewMorphology.js";

describe("stemHebrewToken", () => {
  it("stems short pita plurals (length 4) that the old >4 gate missed", () => {
    expect(stemHebrewToken("פיתות")).toBe("פית");
    expect(stemHebrewToken("פיתה")).toBe("פית");
  });

  it("stems longer plural/singular pairs to the same stem", () => {
    expect(stemHebrewToken("מלפפונים")).toBe(stemHebrewToken("מלפפון"));
    expect(stemHebrewToken("עגבניות")).toBe(stemHebrewToken("עגבניה"));
    expect(stemHebrewToken("בצלים")).toBe(stemHebrewToken("בצל"));
    expect(stemHebrewToken("לימונים")).toBe(stemHebrewToken("לימון"));
  });

  it("does not collapse onion with onion-rings (stem equality, not prefix)", () => {
    expect(stemHebrewToken("בצל")).not.toBe(stemHebrewToken("בצלצלים"));
  });
});

describe("hebrewSingularVariants / expandHebrewQueryVariants", () => {
  it("reconstructs masculine ים plurals with final letters (לימונים→לימון)", () => {
    expect(hebrewSingularVariants("לימונים")).toEqual(["לימון"]);
    expect(hebrewSingularVariants("מלפפונים")).toEqual(["מלפפון"]);
    expect(hebrewSingularVariants("בצלים")).toEqual(["בצל"]);
  });

  it("reconstructs ות plurals as ה/ת singulars", () => {
    expect(hebrewSingularVariants("עגבניות")).toEqual(["עגבניה", "עגבנית"]);
    expect(hebrewSingularVariants("פיתות")).toEqual(["פיתה", "פיתת"]);
    expect(hebrewSingularVariants("פרגיות")).toContain("פרגית");
  });

  it("does not invent variants for already-singular tokens", () => {
    expect(hebrewSingularVariants("לימון")).toEqual([]);
    expect(hebrewSingularVariants("עגבניה")).toEqual([]);
  });

  it("expands produce plural queries for lexical recall", () => {
    expect(expandHebrewQueryVariants("לימונים")).toEqual(["לימונים", "לימון"]);
    expect(expandHebrewQueryVariants("מלפפונים")).toContain("מלפפון");
  });
});

describe("queryTokensSatisfied", () => {
  it("matches פיתות query against פיתה name", () => {
    expect(queryTokensSatisfied(["פיתות"], "פיתה אסלי")).toBe(true);
    expect(queryTokensSatisfied(["פיתה"], "פיתות 10 יח")).toBe(true);
  });

  it("still requires specific tokens", () => {
    expect(queryTokensSatisfied(["יין", "אדום", "קברנה"], "יין אדום מרלו")).toBe(false);
  });

  it("collapses ktiv doubling, as head anchoring already does", () => {
    // The feeds spell one brand several ways: טייסטרס / טסטרס, קורנפלייקס /
    // קורנפלקס. queryHeadAnchored has folded matres lectionis for exactly this
    // reason; this function did not, so a "קפה נמס טייסטרס צ'ויס" line failed to
    // match "קפה נמס מיובש טסטרס צ'ויס 200 גרם" — the very product all five
    // storefronts stock. With no same-brand peer left, the line fell to the
    // category tier and was filled with a chain's own-brand instant coffee at
    // ₪21.90 against Taster's Choice at ₪39.90, which also made that storefront
    // look like the cheapest one.
    expect(queryTokensSatisfied(["טייסטרס"], "קפה נמס מיובש טסטרס צ'ויס 200 גרם")).toBe(true);
    expect(
      queryTokensSatisfied(["קפה", "נמס", "טייסטרס", "צויס"], "קפה נמס מיובש טסטרס צ'ויס 200 גרם"),
    ).toBe(true);
    expect(queryTokensSatisfied(["קורנפלייקס"], "קורנפלקס 500 גרם")).toBe(true);
  });

  it("folding does not merge genuinely different words", () => {
    expect(queryTokensSatisfied(["קברנה"], "יין אדום מרלו")).toBe(false);
    expect(queryTokensSatisfied(["טייסטרס"], "קפה מיובש בהקפאה 200")).toBe(false);
    expect(queryTokensSatisfied(["לימון"], "מלון")).toBe(false);
  });
});
