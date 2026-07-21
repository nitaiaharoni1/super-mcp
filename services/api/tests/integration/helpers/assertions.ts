import { expect } from "vitest";
import { FORBIDDEN_FAST_SELECTIONS } from "../../../src/scripts/canary/telAvivStaplesFixture.js";
import type { BasketOptimizeResult } from "../../../src/services/basket/types.js";

export function assertCompleteBasket(result: BasketOptimizeResult): asserts result is Extract<
  BasketOptimizeResult,
  { status: "complete" }
> {
  expect(result.status, JSON.stringify(result).slice(0, 500)).toBe("complete");
}

/** Names the optimizer actually chose (not candidate pools / debug noise). */
export function selectedProductNames(result: Extract<BasketOptimizeResult, { status: "complete" }>): string[] {
  const names: string[] = [];
  for (const item of result.items) {
    if (item.name) names.push(item.name);
  }
  for (const plan of [result.bestSingleStore, result.cheapestCompleteStore]) {
    for (const line of plan?.lines ?? []) {
      if (line.name) names.push(line.name);
    }
  }
  for (const line of result.multiStore?.lines ?? []) {
    if (line.name) names.push(line.name);
  }
  return names;
}

export function assertNoForbiddenSelections(
  result: Extract<BasketOptimizeResult, { status: "complete" }>,
  forbidden: readonly string[] = FORBIDDEN_FAST_SELECTIONS,
): void {
  const names = selectedProductNames(result);
  const haystack = names.join("\n");
  for (const name of forbidden) {
    expect(haystack.includes(name), `forbidden selection present: ${name}`).toBe(false);
  }
}

export function assertPricedPlan(
  plan: {
    pricedLines: number;
    requestedLines: number;
    total: number | null;
    totalScope?: string;
    storeId?: string;
  } | null,
  label: string,
): void {
  expect(plan, `${label} missing`).not.toBeNull();
  expect(plan!.pricedLines, `${label}.pricedLines`).toBeGreaterThan(0);
  expect(plan!.requestedLines, `${label}.requestedLines`).toBeGreaterThan(0);
  expect(plan!.pricedLines, `${label} coverage`).toBeLessThanOrEqual(plan!.requestedLines);
  if (plan!.total != null) {
    expect(plan!.total, `${label}.total`).toBeGreaterThan(0);
  }
  if (plan!.totalScope != null) {
    expect(["complete_basket", "priced_lines_only"]).toContain(plan!.totalScope);
  }
}

/** Prefer locally priced options; never invent product IDs. */
export function pickConfirmationAnswers(
  result: Extract<BasketOptimizeResult, { status: "needs_confirmation" }>,
): Array<{ item_index: number; product_id: string }> {
  return result.questions.map((q) => {
    const local = q.options.find((o) => o.nearbyPricedStores > 0);
    const pick = local ?? q.options[0];
    if (!pick) {
      throw new Error(`question ${q.id} has no options`);
    }
    return { item_index: q.itemIndex, product_id: pick.productId };
  });
}
