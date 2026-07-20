import { afterEach, describe, expect, it } from "vitest";
import {
  clearResolutionCache,
  getResolution,
  putResolution,
} from "../../../src/services/basket/resolutionCache.js";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

const TTL_MS = 30 * 60 * 1000;

function item(index: number): ResolvedItem {
  return { index, productId: `p${index}`, qty: 1 } as unknown as ResolvedItem;
}

afterEach(() => clearResolutionCache());

describe("resolutionCache", () => {
  it("returns a deep clone, isolated from the cached snapshot and prior reads", () => {
    putResolution("k", [item(0)], 0);
    const first = getResolution("k", 0)!;
    expect(first[0]!.index).toBe(0);
    // Mutating a read must not corrupt the cache or later reads.
    (first[0] as unknown as { productId: string }).productId = "MUTATED";
    const second = getResolution("k", 0)!;
    expect((second[0] as unknown as { productId: string }).productId).toBe("p0");
    expect(second).not.toBe(first);
  });

  it("also snapshots on store (mutating the input after put does not leak)", () => {
    const input = [item(0)];
    putResolution("k", input, 0);
    (input[0] as unknown as { productId: string }).productId = "MUTATED";
    expect((getResolution("k", 0)![0] as unknown as { productId: string }).productId).toBe("p0");
  });

  it("treats the entry as expired at exactly expiresAt (<=), a safe miss", () => {
    putResolution("k", [item(0)], 1_000);
    expect(getResolution("k", 1_000 + TTL_MS - 1)).not.toBeNull();
    expect(getResolution("k", 1_000 + TTL_MS)).toBeNull();
  });

  it("misses on unknown key", () => {
    expect(getResolution("nope", 0)).toBeNull();
  });

  it("evicts the oldest entries once past the capacity cap", () => {
    const CAP = 500;
    for (let i = 0; i < CAP + 5; i += 1) {
      putResolution(`k${i}`, [item(i)], 0);
    }
    // The earliest inserted keys were evicted; the most recent survive.
    expect(getResolution("k0", 0)).toBeNull();
    expect(getResolution(`k${CAP + 4}`, 0)).not.toBeNull();
  });
});
