import { describe, expect, it } from "vitest";
import { inferPackCountFromName, inferPackSizeFromName } from "../../src/utils/units.js";

/**
 * `piece_count` decides whether two SKUs are the same basket line. It was populated
 * for 1.5% of the catalog (canned_fish 3.3%, paper_goods 5.6%), so a 4-tin pack
 * priced against a single tin and a 16-roll pack against a 32-roll one: a 2x
 * quantity error that makes the smaller pack look half price.
 *
 * Every pattern below was measured against the full 122k-name catalog with a
 * control that cannot contain the pattern's own trigger token.
 */
describe("inferPackCountFromName", () => {
  it("stays distinct from inferPackSizeFromName, which returns total contents", () => {
    // The size helper answers "how much is in the pack" because the shelf price
    // covers the whole pack, so for a multipack it can never yield a COUNT. That is
    // precisely why piece_count was empty for the packs that most need it.
    expect(inferPackSizeFromName("שלישיית טונה ריו מרה 3*80 גרם")).toEqual({
      quantity: 240,
      unit: "גרם",
    });
    expect(inferPackCountFromName("שלישיית טונה ריו מרה 3*80 גרם")).toBe(3);

    // It also returns null where a count is still recoverable: the size branch wants
    // "גר'" with an apostrophe, so a bare "גר" parses as no size at all.
    expect(inferPackSizeFromName("טונה סטארקיסט בשמן רביעיות 4*160 גר")).toBeNull();
    expect(inferPackCountFromName("טונה סטארקיסט בשמן רביעיות 4*160 גר")).toBe(4);
  });

  it("reads an explicitly stated unit count", () => {
    expect(inferPackCountFromName("ביצים L רגילות 12 יח")).toBe(12);
    expect(inferPackCountFromName("מארז 10 פיתות")).toBe(10);
    expect(inferPackCountFromName("קש ספירלי צבעוני 100 יחידות")).toBe(100);
  });

  it("reads N x size multipacks", () => {
    expect(inferPackCountFromName("שלישיית טונה ריו מרה 3*80 גרם")).toBe(3);
    expect(inferPackCountFromName("הוטפופ טעם חמאה6*100גר")).toBe(6);
    expect(inferPackCountFromName('יוגורט אקטימל תות בננה 8*100 מ"ל')).toBe(8);
  });

  it("reads Hebrew collective count words in all spellings", () => {
    expect(inferPackCountFromName("המבורגר ביונד מיט זוג 226 גרם")).toBe(2);
    expect(inferPackCountFromName("שלישיית מגבות")).toBe(3);
    expect(inferPackCountFromName("מארז רביעייה")).toBe(4);
    expect(inferPackCountFromName("רביעיה פרוזן יוגורט תות 280 גרם פלדמן")).toBe(4);
    expect(inferPackCountFromName("שישיית מי סודה מוגז רמילוי 250מל")).toBe(6);
    expect(inferPackCountFromName('מארז שמיניית "דנונה"')).toBe(8);
    expect(inferPackCountFromName("עשיריה פיתות כוסמין קלות")).toBe(10);
  });

  it("reads roll counts on either side of the noun", () => {
    expect(inferPackCountFromName("סנו סופט נייר טואלט 18 גלילים כפולים")).toBe(18);
    expect(inferPackCountFromName("לילי פיור נייר טואלט דו שכבתי 30 גלילים")).toBe(30);
    expect(inferPackCountFromName("נייר טואלט גליל כפול 16 רמילוי")).toBe(16);
    expect(inferPackCountFromName("נייר טואלט 48 גלילים qve")).toBe(48);
  });

  it("reads egg trays only when the name is about eggs", () => {
    expect(inferPackCountFromName("תבנית 30 ביצים L")).toBe(30);
    expect(inferPackCountFromName("12 ביצי משק S-הגליל משאב")).toBe(12);
    // 12 of 18 `תבנית N` matches are baking trays where N is cavities or cm.
    expect(inferPackCountFromName("תבנית 12 שקעים מאפינ")).toBeNull();
    expect(inferPackCountFromName("תבנית 19*28 סמ 2.4 ל")).toBeNull();
    expect(inferPackCountFromName('תבנית 26סמ+בסיס קוגל')).toBeNull();
  });

  describe("false positives measured against the real catalog", () => {
    it("does not read a gift-box size as a count", () => {
      // `מארז` is also "gift box", so the number after it is often a measurement.
      for (const name of [
        'קוניאק נולין VSOP  מארז 700 מ"ל',
        "רוקט מארז 100 גרם",
        "מואט ושנדו ברוט אימפריאל מארז 750 מל",
        "קבנוס עגל מארז 250 ג",
        "בזיליקום מארז 100 גרם",
      ]) {
        expect(inferPackCountFromName(name), name).toBeNull();
      }
    });

    it("does not read גליל as the Galilee region or the פרי גליל brand", () => {
      // Ungated, this pattern matched 27 names of which 24 were wrong.
      for (const name of [
        'יין אלה הרי גליל  750 מל',
        "טונה פרי גליל 160גרם",
        "פסטה רג'ייה גליל 500",
        "מנטוס תות גליל 37.5 גר",
        "אוראו מילוי בראוניז גליל 154 גר",
        'צופית דבש מלא פרחי הרי גליל 1 ק"ג',
      ]) {
        expect(inferPackCountFromName(name), name).toBeNull();
      }
    });

    it("does not read a reversed size x count form as the count", () => {
      // "80*3 גרם" is three 80g tins. Rejecting it is a miss, not a wrong count,
      // and most such names also carry a count word that does match.
      expect(inferPackCountFromName("טונה בהירה בשמן 80*3 גרם")).toBeNull();
      expect(inferPackCountFromName("סבון מוצק-קמומיל 90*4 גר")).toBeNull();
      expect(inferPackCountFromName('אשפתון 65X54 L חזקות')).toBeNull();
    });

    it("reports unknown for a pack of packs rather than a misleading half-answer", () => {
      // "70 יח שלישייה" is three packs of seventy; the only correct answer is 210,
      // and neither 70 nor 3 is it. 12 such names catalog-wide.
      expect(inferPackCountFromName("פדים קוסמטיקה 70 יח שלישייה")).toBeNull();
      expect(inferPackCountFromName("פלסטר מארז זוג 80 יחידות")).toBeNull();
      expect(inferPackCountFromName("חמישיה שקיות הקפאה 100יח")).toBeNull();
    });

    it("does not invent a count when the name says pack without a number", () => {
      expect(inferPackCountFromName("מארז מגבות פנים וגוף")).toBeNull();
      expect(inferPackCountFromName("מארז בקרדי בריזר אבט")).toBeNull();
    });

    it("does not mistake a plain size for a count", () => {
      expect(inferPackCountFromName("שמן זית כתית מעולה 750 מל")).toBeNull();
      expect(inferPackCountFromName("חמאה תנובה 200 גרם מהדרין")).toBeNull();
      expect(inferPackCountFromName("חלה קלועה אנגל 650 ג")).toBeNull();
      expect(inferPackCountFromName("רויטליפט פילר קרם גל50מל")).toBeNull();
    });

    it("never returns a value outside plausible pack bounds", () => {
      expect(inferPackCountFromName("מרכך כביסה מרוכז לבן 1*5 ליטר טאצ")).toBeNull();
      expect(inferPackCountFromName(null)).toBeNull();
      expect(inferPackCountFromName("")).toBeNull();
    });
  });
});
