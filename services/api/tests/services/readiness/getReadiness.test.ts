import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({
    rows: [
      {
        total_stores: "10",
        stores_with_valid_coordinates: "8",
        current_price_rows: "125",
        stores_with_current_prices: "6",
        newest_price_source_ts: "2026-07-17T18:00:00.000Z",
      },
    ],
  }),
}));
vi.mock("@super-mcp/db", () => ({ query }));

import {
  _resetReadinessCacheForTests,
  getReadiness,
} from "../../../src/services/readiness/getReadiness.js";

describe("getReadiness", () => {
  beforeEach(() => {
    _resetReadinessCacheForTests();
    query.mockClear();
  });

  it("reports coordinate coverage and current local-price availability", async () => {
    const result = await getReadiness();

    expect(result.status).toBe("ready");
    expect(result.storeCoordinates).toEqual({
      total: 10,
      valid: 8,
      coverage: 0.8,
    });
    expect(result.localPrices).toMatchObject({
      currentRows: 125,
      storesWithCurrentPrices: 6,
      newestSourceTs: "2026-07-17T18:00:00.000Z",
      freshnessHours: 48,
    });
  });

  // The aggregate cannot use an index and reads ~4M heap tuples, and /ready is
  // public and unauthenticated, so "one scan per request" was a way for any
  // caller to saturate a single-instance service.
  it("serves a second call from cache instead of scanning again", async () => {
    const first = await getReadiness();
    const second = await getReadiness();

    expect(query).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // Same object, so a cached answer keeps the checkedAt of the scan that
    // produced it rather than claiming to be current.
    expect(second.checkedAt).toBe(first.checkedAt);
  });

  it("collapses concurrent callers onto a single scan", async () => {
    const [a, b, c] = await Promise.all([getReadiness(), getReadiness(), getReadiness()]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("does not wedge later callers when a scan fails", async () => {
    query.mockRejectedValueOnce(new Error("statement timeout"));

    await expect(getReadiness()).rejects.toThrow("statement timeout");
    // A rejected in-flight promise must not be handed to everyone after it.
    await expect(getReadiness()).resolves.toMatchObject({ status: "ready" });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
