import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import {
  MAX_RECONCILE_DELETE_RATIO,
  MIN_RECONCILE_SEEN_ROWS,
  reconcileStorePrices,
} from "../../src/queries/reconcile.js";

const SEEN_SINCE = new Date("2026-07-25T06:00:00Z");

/** First call returns the counts; the second (if reached) is the DELETE. */
function mockCounts(totalBefore: number, staleFound: number, deleted = staleFound): void {
  query.mockReset();
  query
    .mockResolvedValueOnce({
      rows: [{ total_before: String(totalBefore), stale_found: String(staleFound) }],
    })
    .mockResolvedValueOnce({ rowCount: deleted });
}

describe("reconcileStorePrices", () => {
  beforeEach(() => query.mockReset());

  it("deletes rows a full snapshot did not refresh", async () => {
    mockCounts(1000, 50);
    const result = await reconcileStorePrices({
      storeId: "store-1",
      seenSince: SEEN_SINCE,
      rowsSeen: 950,
    });

    expect(result.deleted).toBe(50);
    expect(result.staleFound).toBe(50);
    expect(result.skipped).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).toContain("DELETE FROM store_price");
    // The cutoff, not "now", decides staleness.
    expect(query.mock.calls[1]?.[1]).toEqual(["store-1", SEEN_SINCE]);
  });

  it("does nothing when the snapshot refreshed everything", async () => {
    mockCounts(1000, 0);
    const result = await reconcileStorePrices({
      storeId: "store-1",
      seenSince: SEEN_SINCE,
      rowsSeen: 1000,
    });

    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe("nothing_stale");
    expect(query).toHaveBeenCalledTimes(1); // no DELETE issued
  });

  it("refuses to delete from an implausibly small snapshot (truncated download)", async () => {
    mockCounts(1000, 900);
    const result = await reconcileStorePrices({
      storeId: "store-1",
      seenSince: SEEN_SINCE,
      rowsSeen: MIN_RECONCILE_SEEN_ROWS - 1,
    });

    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe("too_few_rows_seen");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("refuses to delete more than the safety ratio of a store's catalogue", async () => {
    // 60% stale is far likelier to be a bad file than a real mass delisting.
    mockCounts(1000, 600);
    const result = await reconcileStorePrices({
      storeId: "store-1",
      seenSince: SEEN_SINCE,
      rowsSeen: 400,
    });

    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe("delete_ratio_exceeded");
    expect(result.staleFound).toBe(600);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("deletes right up to the safety ratio", async () => {
    const stale = Math.floor(1000 * MAX_RECONCILE_DELETE_RATIO);
    mockCounts(1000, stale);
    const result = await reconcileStorePrices({
      storeId: "store-1",
      seenSince: SEEN_SINCE,
      rowsSeen: 1000 - stale,
    });

    expect(result.skipped).toBeNull();
    expect(result.deleted).toBe(stale);
  });

  it("treats a NULL last_seen_at as stale (pre-migration rows)", async () => {
    mockCounts(100, 10);
    await reconcileStorePrices({ storeId: "s", seenSince: SEEN_SINCE, rowsSeen: 90 });

    expect(String(query.mock.calls[0]?.[0])).toContain("last_seen_at IS NULL");
    expect(String(query.mock.calls[1]?.[0])).toContain("last_seen_at IS NULL");
  });

  it("honours caller-supplied thresholds", async () => {
    mockCounts(1000, 600);
    const result = await reconcileStorePrices({
      storeId: "s",
      seenSince: SEEN_SINCE,
      rowsSeen: 400,
      maxDeleteRatio: 0.9,
      minSeenRows: 10,
    });

    expect(result.skipped).toBeNull();
    expect(result.deleted).toBe(600);
  });
});
