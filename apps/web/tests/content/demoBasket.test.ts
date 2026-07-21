import { describe, expect, it } from "vitest";

import { DEMO_SAMPLE_LABEL, demoBasket } from "@/content/demoBasket";

describe("demoBasket fixture", () => {
  it("is explicitly labeled as a non-live sample", () => {
    expect(demoBasket.label).toBe(DEMO_SAMPLE_LABEL);
    expect(demoBasket.label).toMatch(/דוגמה|לא חי/);
  });

  it("matches optimize_basket status flow contract", () => {
    expect(demoBasket.tool).toBe("optimize_basket");
    expect([...demoBasket.statusFlow]).toEqual(["needs_confirmation", "complete"]);
    expect(demoBasket.question.options.length).toBeGreaterThan(1);
  });

  it("exposes complete plans with coverage and totals from the fixture only", () => {
    const { bestSingleStore, cheapestCompleteStore, multiStore } = demoBasket.complete;

    expect(bestSingleStore.pricedLines).toBeLessThanOrEqual(bestSingleStore.requestedLines);
    expect(bestSingleStore.coverageRatio).toBeCloseTo(
      bestSingleStore.pricedLines / bestSingleStore.requestedLines,
    );
    expect(bestSingleStore.total).toBeGreaterThan(0);
    expect(bestSingleStore.currency).toBe("ILS");
    expect(bestSingleStore.missingItems.length).toBe(
      bestSingleStore.requestedLines - bestSingleStore.pricedLines,
    );

    expect(cheapestCompleteStore.coverageRatio).toBe(1);
    expect(cheapestCompleteStore.missingItems).toEqual([]);
    expect(multiStore.storeCount).toBeGreaterThan(1);
    expect(multiStore.coverageRatio).toBe(1);
  });

  it("keeps normalization artifact fields consistent", () => {
    const { normalization } = demoBasket;
    expect(normalization.gtin).toMatch(/^\d{8,14}$/);
    expect(normalization.listings.length).toBeGreaterThanOrEqual(2);
    expect(normalization.canonical.unitPricePer100ml).toBeGreaterThan(0);
  });

  it("does not invent savings percentages or customer claims", () => {
    const blob = JSON.stringify(demoBasket);
    expect(blob).not.toMatch(/customers|%\s*חיסכון|savings|guarantee/i);
    expect(blob).toContain("דוגמה");
    expect(demoBasket.label).toContain("לא חי");
  });
});
