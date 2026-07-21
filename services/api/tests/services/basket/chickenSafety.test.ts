import { describe, expect, it } from "vitest";
import {
  chickenNameIsUndesired,
  isGenericChickenQuery,
  rejectUnsafeChickenName,
} from "../../../src/services/basket/chickenSafety.js";

describe("chickenSafety", () => {
  it("treats bare עוף as generic and named cuts as specific", () => {
    expect(isGenericChickenQuery("עוף")).toBe(true);
    expect(isGenericChickenQuery("עוף טרי")).toBe(true);
    expect(isGenericChickenQuery("כבד עוף")).toBe(false);
    expect(isGenericChickenQuery("שניצל עוף")).toBe(false);
    expect(isGenericChickenQuery("לחם")).toBe(false);
  });

  it("flags organs and processed forms for bare עוף", () => {
    const q = ["עוף"];
    expect(chickenNameIsUndesired("כבד עוף טרי", q)).toBe(true);
    expect(chickenNameIsUndesired("גרון עוף לולו", q)).toBe(true);
    expect(chickenNameIsUndesired("עוף טחון", q)).toBe(true);
    expect(chickenNameIsUndesired("שניצל עוף", q)).toBe(true);
    expect(chickenNameIsUndesired("חזה עוף טרי", q)).toBe(false);
    expect(chickenNameIsUndesired("עוף טרי שלם", q)).toBe(false);
  });

  it("does not treat עגבניות as containing organ token גב", () => {
    expect(chickenNameIsUndesired("עגבניות טרי", ["עוף"])).toBe(false);
  });

  it("allows organs/processed only when the query asks for them", () => {
    expect(rejectUnsafeChickenName("עוף", "כבד עוף טרי")).toBe(true);
    expect(rejectUnsafeChickenName("כבד עוף", "כבד עוף טרי")).toBe(false);
    expect(rejectUnsafeChickenName("שניצל עוף", "שניצל עוף טרי")).toBe(false);
  });
});
