import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Expire the 60s cache without dropping `lastGood`, which is what the stale path needs. */
function _expireCache(): void {
  vi.setSystemTime(Date.now() + 61_000);
}

describe("getReadiness", () => {
  beforeEach(() => {
    _resetReadinessCacheForTests();
    query.mockReset();
    query.mockResolvedValue({
      rows: [
        {
          total_stores: "10",
          stores_with_valid_coordinates: "8",
          current_price_rows: "125",
          stores_with_current_prices: "6",
          newest_price_source_ts: "2026-07-17T18:00:00.000Z",
        },
      ],
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  // The nightly ingest pushes this aggregate past the 30s statement_timeout, and
  // /ready answered 500 for the whole six-hour window while /mcp served baskets
  // normally. A failed scan is not evidence the service is unready.
  it("serves the last good report when a later scan fails", async () => {
    const good = await getReadiness();
    expect(good.status).toBe("ready");

    _expireCache();
    query.mockRejectedValueOnce(new Error("canceling statement due to statement timeout"));

    const during = await getReadiness();
    expect(during).toEqual(good);
    expect(during.status).toBe("ready");
  });

  it("keeps the stale checkedAt so the answer admits its age", async () => {
    const good = await getReadiness();
    _expireCache();
    query.mockRejectedValueOnce(new Error("timeout"));

    const during = await getReadiness();
    expect(during.checkedAt).toBe(good.checkedAt);
  });

  it("still reports failure when no scan has ever succeeded", async () => {
    _resetReadinessCacheForTests();
    query.mockReset();
    query.mockRejectedValue(new Error("timeout"));

    await expect(getReadiness()).rejects.toThrow("timeout");
  });
});
