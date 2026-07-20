import { describe, expect, it } from "vitest";
import {
  resolveCoverageClassScope,
  scopedClassesConflict,
} from "../../../src/services/basket/coverageScope.js";

const redWine = {
  classL1: "alcohol",
  classL2: "wine",
  classL3: "red_wine",
};

const whiteWine = {
  classL1: "alcohol",
  classL2: "wine",
  classL3: "white_wine",
};

describe("resolveCoverageClassScope", () => {
  it("bare יין relaxes to the wine family (L2)", () => {
    const scope = resolveCoverageClassScope("יין", redWine);
    expect(scope).toMatchObject({
      classL1: "alcohol",
      classL2: "wine",
      classL3: null,
      depth: "l2",
    });
  });

  it("יין with amount wording still relaxes when no color/varietal pin", () => {
    const scope = resolveCoverageClassScope("3 בקבוקי יין", redWine);
    expect(scope?.depth).toBe("l2");
    expect(scope?.classL3).toBeNull();
  });

  it("יין אדום keeps the red_wine leaf", () => {
    const scope = resolveCoverageClassScope("יין אדום", redWine);
    expect(scope).toMatchObject({
      classL3: "red_wine",
      depth: "l3",
    });
  });

  it("יין אדום קברנה keeps the leaf (varietal pin)", () => {
    const scope = resolveCoverageClassScope("יין אדום קברנה", redWine);
    expect(scope?.depth).toBe("l3");
    expect(scope?.classL3).toBe("red_wine");
  });

  it("produce cucumber keeps L3", () => {
    const scope = resolveCoverageClassScope("מלפפונים", {
      classL1: "produce",
      classL2: "vegetable_fresh",
      classL3: "cucumber",
    });
    expect(scope?.depth).toBe("l3");
    expect(scope?.classL3).toBe("cucumber");
  });
});

describe("scopedClassesConflict", () => {
  it("bare wine scope treats red vs white as interchangeable", () => {
    const scope = resolveCoverageClassScope("יין", redWine)!;
    expect(scopedClassesConflict(redWine, whiteWine, scope)).toBe(false);
  });

  it("red wine scope treats white as conflicting", () => {
    const scope = resolveCoverageClassScope("יין אדום", redWine)!;
    expect(scopedClassesConflict(redWine, whiteWine, scope)).toBe(true);
  });

  it("bare wine scope still conflicts with non-wine alcohol", () => {
    const scope = resolveCoverageClassScope("יין", redWine)!;
    expect(
      scopedClassesConflict(
        redWine,
        { classL1: "alcohol", classL2: "vodka", classL3: null },
        scope,
      ),
    ).toBe(true);
    expect(
      scopedClassesConflict(
        redWine,
        { classL1: "alcohol", classL2: "beer", classL3: null },
        scope,
      ),
    ).toBe(true);
  });
});
