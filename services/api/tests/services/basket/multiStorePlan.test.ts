import { describe, expect, it } from "vitest";
import { buildMultiStorePlan } from "../../../src/services/basket/substitutions.js";
import type {
  BasketLine,
  BasketStoreResult,
  ResolvedItem,
} from "../../../src/services/basket/types.js";

/** Minimal resolved line — buildMultiStorePlan only reads index + productId. */
function resolved(index: number, productId: string | null): ResolvedItem {
  return { index, productId } as unknown as ResolvedItem;
}

function line(itemIndex: number, lineTotal: number): BasketLine {
  return {
    itemIndex,
    productId: `p${itemIndex}`,
    name: `item ${itemIndex}`,
    qty: 1,
    unitPrice: lineTotal,
    lineTotal,
    link: null,
  } as unknown as BasketLine;
}

/** Store carrying the given (itemIndex → lineTotal) prices. */
function store(id: string, prices: Record<number, number>): BasketStoreResult {
  return {
    storeId: id,
    storeName: id,
    chainId: id,
    chainName: id,
    address: null,
    currency: "ILS",
    lines: Object.entries(prices).map(([i, total]) => line(Number(i), total)),
  } as unknown as BasketStoreResult;
}

describe("buildMultiStorePlan (bounded set-cover)", () => {
  it("returns null with no stores and no coverable lines", () => {
    expect(buildMultiStorePlan([resolved(0, "p0")], [])).toBeNull();
    expect(
      buildMultiStorePlan([resolved(0, null)], [store("A", { 0: 5 })]),
    ).toBeNull();
  });

  it("keeps a single store when one covers everything (cheapest such store wins)", () => {
    // Both A and B fully cover; phase-1 tiebreak prefers the cheaper full-cover
    // store (B: 9+19=28 < A: 30). No second store needed.
    const stores = [store("A", { 0: 10, 1: 20 }), store("B", { 0: 9, 1: 19 })];
    const plan = buildMultiStorePlan([resolved(0, "p0"), resolved(1, "p1")], stores);
    expect(plan?.storeCount).toBe(1);
    expect(plan?.lines.every((l) => l.storeId === "B")).toBe(true);
    expect(plan?.total).toBe(28);
  });

  it("adds a second store when its marginal savings clear the threshold", () => {
    // A is the cheapest full-cover store (110). C only covers item 1 cheaply,
    // saving ₪30 there (100→70) > ₪20 threshold, so C is added.
    const stores = [store("A", { 0: 10, 1: 100 }), store("C", { 0: 200, 1: 70 })];
    const plan = buildMultiStorePlan([resolved(0, "p0"), resolved(1, "p1")], stores);
    expect(plan?.storeCount).toBe(2);
    expect(plan?.total).toBe(80); // 10 (A) + 70 (C)
    expect(plan?.lines.find((l) => l.itemIndex === 0)?.storeId).toBe("A");
    expect(plan?.lines.find((l) => l.itemIndex === 1)?.storeId).toBe("C");
  });

  it("does NOT add a second store when savings are below the threshold", () => {
    // C would save only ₪15 on item 1 (100→85) < ₪20 → stays single-store A.
    const stores = [store("A", { 0: 10, 1: 100 }), store("C", { 0: 200, 1: 85 })];
    const plan = buildMultiStorePlan([resolved(0, "p0"), resolved(1, "p1")], stores);
    expect(plan?.storeCount).toBe(1);
    expect(plan?.total).toBe(110);
  });

  it("splits when no single store covers the whole basket", () => {
    // A covers only item 0, B only item 1 — coverage forces both stores.
    const stores = [store("A", { 0: 10 }), store("B", { 1: 15 })];
    const plan = buildMultiStorePlan([resolved(0, "p0"), resolved(1, "p1")], stores);
    expect(plan?.storeCount).toBe(2);
    expect(plan?.lines.length).toBe(2);
    expect(plan?.total).toBe(25);
  });

  it("exceeds maxStores when full coverage genuinely requires it", () => {
    // Each item is carried by exactly one distinct store → coverage needs 3 stores.
    const stores = [
      store("A", { 0: 5 }),
      store("B", { 1: 5 }),
      store("C", { 2: 5 }),
    ];
    const items = [resolved(0, "p0"), resolved(1, "p1"), resolved(2, "p2")];
    const plan = buildMultiStorePlan(items, stores, { maxStores: 1 });
    expect(plan?.lines.length).toBe(3); // full coverage preserved over the cap
    expect(plan?.storeCount).toBe(3);
    expect(plan?.missingItemIndexes).toEqual([]);
  });

  it("marks items priced by no store as missing but still plans the rest", () => {
    const stores = [store("A", { 0: 5 })];
    const plan = buildMultiStorePlan([resolved(0, "p0"), resolved(1, "p1")], stores);
    expect(plan?.lines.map((l) => l.itemIndex)).toEqual([0]);
    expect(plan?.missingItemIndexes).toEqual([1]);
  });

  it("is deterministic across runs", () => {
    const build = () =>
      buildMultiStorePlan(
        [resolved(0, "p0"), resolved(1, "p1")],
        [store("A", { 0: 10, 1: 40 }), store("B", { 0: 12, 1: 15 })],
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
