import { describe, expect, it } from "vitest";
import {
  hasUnrequestedDerivedForm,
  preferDirectForm,
} from "../../../src/services/basket/derivedForm.js";

/**
 * Cases are real catalog names (with their nearby-store counts noted where the
 * count is what makes the case matter). The false-positive half is as important
 * as the true-positive half: an over-eager guard silently deletes staples from
 * the pool, which is how the household aisle went missing.
 */
describe("hasUnrequestedDerivedForm", () => {
  it("rejects a product made FROM the staple, in either word order", () => {
    // Staple first — the shape queryHeadAnchored cannot see, since the head leads.
    expect(hasUnrequestedDerivedForm("אורז", "אורז אטריות")).toBe(true);
    // Modifier first.
    expect(hasUnrequestedDerivedForm("אורז", 'דפי אורז עגול 22 ס"מ')).toBe(true);
    expect(hasUnrequestedDerivedForm("אורז", "מקלוני אורז ללא גלוטן")).toBe(true);
    expect(hasUnrequestedDerivedForm("אורז", "פריכיות אורז חום מלא")).toBe(true);
    expect(hasUnrequestedDerivedForm("לחם", "פירורי לחם מוזהבים 200 גרם")).toBe(true);
    expect(hasUnrequestedDerivedForm("עגבניות", "רוטב עגבניות מרוכז מאוד")).toBe(true);
    expect(hasUnrequestedDerivedForm("חלב", "שוקולד חלב פרה במילוי קרם")).toBe(true);
    expect(hasUnrequestedDerivedForm("ביצים", "אטריות ביצים דקות 400 גרם")).toBe(true);
    expect(hasUnrequestedDerivedForm("טונה", "סלט טונה פיקנטי יונה 170 גרם")).toBe(true);
    expect(hasUnrequestedDerivedForm("טונה", "ארוחת טונה עם גרגרי חומוס")).toBe(true);
  });

  it("keeps the staple itself", () => {
    expect(hasUnrequestedDerivedForm("אורז", 'אורז בסמטי קלאסי 1 ק"ג סוגת')).toBe(false);
    expect(hasUnrequestedDerivedForm("אורז", 'אורז עגול ריזוטו 1 ק"ג סוגת')).toBe(false);
    expect(hasUnrequestedDerivedForm("אורז", "אורז מלא")).toBe(false);
    expect(hasUnrequestedDerivedForm("לחם", "לחם אחיד פרוס 900 גרם")).toBe(false);
    expect(hasUnrequestedDerivedForm("חלב", "חלב תנובה 3% שומן 1 ל' קרטון")).toBe(false);
    expect(hasUnrequestedDerivedForm("ביצים", "ביצים L רגילות 12 יח")).toBe(false);
    expect(hasUnrequestedDerivedForm("עגבניות", "עגבניות מרוסקות 180 גרם יכין")).toBe(false);
    expect(hasUnrequestedDerivedForm("שמן זית", 'שמן זית כתית מעולה 750 מ"ל')).toBe(false);
  });

  it("keeps the derived product when the shopper asked for it", () => {
    expect(hasUnrequestedDerivedForm("אטריות אורז", "אטריות אורז רחבות")).toBe(false);
    expect(hasUnrequestedDerivedForm("רוטב עגבניות", "רוטב עגבניות מרוכז מאוד")).toBe(false);
  });

  it("treats a flavour marker as disqualifying only when it leads the staple", () => {
    // The staple is the FLAVOUR: margarine (696 stores) and popcorn outranked real
    // butter on availability for a bare חמאה line.
    expect(hasUnrequestedDerivedForm("חמאה", "מרגרינה בטעם חמאה שמרית 200 גר")).toBe(true);
    expect(hasUnrequestedDerivedForm("חמאה", "מזולה בטעם חמאה 250 גרם")).toBe(true);
    // The staple is the PRODUCT and the flavour is incidental — still yogurt.
    expect(hasUnrequestedDerivedForm("יוגורט", "יוגורט בטעם תות")).toBe(false);
  });

  it("does not fire on words that merely stem alike", () => {
    // שמן (oil) folds+stems to the same form as שמנת (cream); treating cream as a
    // derived form rejected every tuna-in-oil (744 stores) and half-cream butter.
    expect(hasUnrequestedDerivedForm("טונה", "טונה סטארקיסט בשמן רביעיות 4*160 גר")).toBe(false);
    expect(hasUnrequestedDerivedForm("חמאה", "חמאה מלוחה חצי שמנת אלוויר 200 גר")).toBe(false);
    // לבן = "white", the catalog's most common colour word, not leben.
    expect(hasUnrequestedDerivedForm("גבינה", "גבינה לבנה תנובה 5% שומן 250 גרם")).toBe(false);
    expect(
      hasUnrequestedDerivedForm("נייר טואלט", "נייר טואלט פרימיום לבן קלינקס 9 גלילים"),
    ).toBe(false);
    // גבינת/גבינה share a stem, so cottage cheese is not a derived form of cottage.
    expect(hasUnrequestedDerivedForm("קוטג", "גבינת קוטג' מועשר 5% טרה 250 גרם")).toBe(false);
  });

  it("ignores a marker that trails far behind the head (brand collision)", () => {
    // "ד\"ר מרק" is a bakery brand; מרק (soup) must not disqualify sourdough bread.
    expect(
      hasUnrequestedDerivedForm("לחם", 'לחם מחמצת מכוסמין מלא ד"ר מרק 450 גרם'),
    ).toBe(false);
  });

  it("is inert without a query or a name", () => {
    expect(hasUnrequestedDerivedForm("", "אורז אטריות")).toBe(false);
    expect(hasUnrequestedDerivedForm("אורז", "")).toBe(false);
  });
});

describe("preferDirectForm", () => {
  it("demotes derived forms but never empties the list", () => {
    const items = [
      { name: "אורז אטריות" },
      { name: 'אורז בסמטי 1 ק"ג' },
      { name: "דפי אורז" },
    ];
    expect(preferDirectForm("אורז", items).map((i) => i.name)).toEqual([
      'אורז בסמטי 1 ק"ג',
      "אורז אטריות",
      "דפי אורז",
    ]);
  });

  it("keeps the original order when every candidate is a derived form", () => {
    const items = [{ name: "אורז אטריות" }, { name: "דפי אורז" }];
    expect(preferDirectForm("אורז", items).map((i) => i.name)).toEqual([
      "אורז אטריות",
      "דפי אורז",
    ]);
  });
});
