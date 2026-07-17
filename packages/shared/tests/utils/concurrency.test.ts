import { describe, expect, it } from "vitest";
import { mapPool } from "../../src/utils/concurrency.js";

describe("mapPool", () => {
  it("preserves order and respects concurrency", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("returns empty array for empty input", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
