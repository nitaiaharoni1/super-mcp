import { describe, expect, it } from "vitest";
import {
  isGenericMilkQuery,
  plainMilkNameIsUndesired,
  rejectUnsafePlainMilkName,
} from "../../../src/services/basket/milkSafety.js";

describe("milkSafety", () => {
  it("treats bare חלב as a generic milk query", () => {
    expect(isGenericMilkQuery("חלב")).toBe(true);
    expect(isGenericMilkQuery("חלב תנובה")).toBe(true);
    expect(isGenericMilkQuery("חלב מרוכז")).toBe(false);
    expect(isGenericMilkQuery("לחם")).toBe(false);
  });

  it("flags condensed, powder, flavored, and plant milks", () => {
    const q = ["חלב"];
    expect(plainMilkNameIsUndesired("חלב מרוכז וממותק", q)).toBe(true);
    expect(plainMilkNameIsUndesired("אבקת חלב", q)).toBe(true);
    expect(plainMilkNameIsUndesired("חלב בטעם וניל", q)).toBe(true);
    expect(plainMilkNameIsUndesired("משקה חלב 1.5%", q)).toBe(true);
    expect(plainMilkNameIsUndesired("חלב פנים גאלאטה", q)).toBe(true);
    expect(plainMilkNameIsUndesired("חלב שקדים", q)).toBe(true);
    expect(plainMilkNameIsUndesired("חלב טרי 3%", q)).toBe(false);
    expect(plainMilkNameIsUndesired("חלב תנובה 1%", q)).toBe(false);
  });

  it("allows specialty forms when the query asks for them", () => {
    expect(rejectUnsafePlainMilkName("חלב מרוכז", "חלב מרוכז וממותק")).toBe(false);
    expect(rejectUnsafePlainMilkName("חלב שקדים", "חלב שקדים אלפרו")).toBe(false);
    expect(rejectUnsafePlainMilkName("חלב", "חלב מרוכז וממותק")).toBe(true);
  });

  it("rejects halvah false friends for milk queries", () => {
    expect(rejectUnsafePlainMilkName("חלב", "חלבה במשקל")).toBe(true);
    expect(rejectUnsafePlainMilkName("חלבה", "חלבה במשקל")).toBe(false);
  });
});
