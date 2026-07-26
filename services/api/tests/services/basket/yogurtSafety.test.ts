/**
 * "יוגורט" means a cup you eat with a spoon, not a bottle you drink.
 *
 * A live basket asked for "4 יוגורט" and got four 8-packs of Actimel: 32
 * drinking bottles for ₪79.60, when a plain cup stocked in 766 stores was
 * sitting in the candidate pool. Drinking yogurt is genuinely well stocked, so
 * the availability rule preferred it, and nothing in the pipeline knew the two
 * are different products to a shopper.
 *
 * The size unit cannot decide this. Israeli feeds label spoonable yogurt in ml
 * as often as in grams ("יוגורט פרופ מולר 150 מ\"ל" is a cup, "יוגורט סמיך GO
 * 200 מל" is thick spoonable), so the discriminator has to be the product's own
 * name.
 *
 * Same shape as the חלב and עוף guards: it fires only for a query that does NOT
 * itself ask for the drinking form, so "משקה יוגורט" or "יוגורט לשתייה" still
 * work normally.
 */
import { describe, expect, it } from "vitest";
import { rejectUnsafePlainYogurtName } from "../../../src/services/basket/yogurtSafety.js";

describe("a bare yogurt line rejects the drinking form", () => {
  it("rejects the drinks that beat the cups on availability", () => {
    expect(rejectUnsafePlainYogurtName("יוגורט", 'יוגורט אקטימל 8*100 מ"ל')).toBe(true);
    expect(rejectUnsafePlainYogurtName("יוגורט", "משקה יוגורט דנונה תות בננה 267 גרם")).toBe(true);
    expect(rejectUnsafePlainYogurtName("יוגורט", 'יוגורט עיזים לשתיה 3% מחלבות גד 500 מ"ל')).toBe(true);
    expect(rejectUnsafePlainYogurtName("יוגורט", 'אירן משקה יוגורט 500 מ"ל')).toBe(true);
    expect(rejectUnsafePlainYogurtName("יוגורט", "דני בטעם שוקולד לשתייה 4*125 מ\"ל")).toBe(true);
  });

  it("keeps every spoonable cup, including the ones measured in ml", () => {
    expect(rejectUnsafePlainYogurtName("יוגורט", "יוגורט דנונה ביו לבן 3% שומן")).toBe(false);
    expect(rejectUnsafePlainYogurtName("יוגורט", 'יוגורט פרופ תות 3% מולר 150 מ"ל')).toBe(false);
    expect(rejectUnsafePlainYogurtName("יוגורט", "יוגורט סמיך תות 0% 200 מל GO")).toBe(false);
    expect(rejectUnsafePlainYogurtName("יוגורט", "יוגורט תנובה 5% גביע")).toBe(false);
    // A multipack of cups is still cups; this guard is about form, not count.
    expect(rejectUnsafePlainYogurtName("יוגורט", 'יוגורט דנונה ביו לבן 3% שומן 8*150 מ"ל')).toBe(false);
  });

  it("does not fire when the shopper asked for the drink", () => {
    expect(rejectUnsafePlainYogurtName("משקה יוגורט", 'אירן משקה יוגורט 500 מ"ל')).toBe(false);
    expect(rejectUnsafePlainYogurtName("יוגורט לשתייה", "יוגורט עיזים לשתיה 3%")).toBe(false);
    expect(rejectUnsafePlainYogurtName("אקטימל", 'יוגורט אקטימל 8*100 מ"ל')).toBe(false);
  });

  it("stays out of the way of every other line", () => {
    expect(rejectUnsafePlainYogurtName("חלב", "משקה חלב סויה")).toBe(false);
    expect(rejectUnsafePlainYogurtName("נייר טואלט", "נייר טואלט 32 גליל")).toBe(false);
    expect(rejectUnsafePlainYogurtName("", 'יוגורט אקטימל 8*100 מ"ל')).toBe(false);
  });
});
