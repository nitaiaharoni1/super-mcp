import { describe, expect, it, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { purgeExpiredPromotions } from "../../src/queries/promotions.js";

describe("sweeping promotions that finished", () => {
  // Braces matter. `mockReset()` returns the mock, and a value returned from
  // beforeEach is taken as the teardown callback, so the concise-body form made
  // vitest call `query()` after every test in this file. Harmless while every
  // mock resolved, and an unexplained failure the moment one throws.
  beforeEach(() => {
    query.mockReset();
  });

  it("keeps going until a batch comes back empty", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 20000 })
      .mockResolvedValueOnce({ rowCount: 20000 })
      .mockResolvedValueOnce({ rowCount: 137 })
      .mockResolvedValueOnce({ rowCount: 0 });

    const result = await purgeExpiredPromotions(14);
    expect(result.promotionsDeleted).toBe(40137);
    expect(result.capped).toBe(false);
    // One statement per batch, each committing on its own: a single transaction
    // deleting millions of promotion_item rows both holds locks and floods WAL
    // on the small instance this runs against.
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("passes the retention window through, not a hardcoded one", async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpiredPromotions(30);
    expect(query.mock.calls[0]?.[1]).toEqual(["30", 20000]);
  });

  it("reports when the cap stopped it early instead of claiming it finished", async () => {
    // A sweep that hit the cap has more to do; saying so lets the next run
    // continue rather than the caller assuming the table is clean.
    query.mockResolvedValue({ rowCount: 20000 });
    const result = await purgeExpiredPromotions(14);
    expect(result.capped).toBe(true);
    expect(result.promotionsDeleted).toBe(2000 * 20000);
  });

  it("shrinks the batch and carries on when one times out", async () => {
    // The pool pins statement_timeout=30000 and a 20,000-promotion batch is
    // really ~126,000 row deletions once the promotion_item cascade and seven
    // indexes are counted. Without this the first sweep, the only one big
    // enough to be at risk, throws and the table never gets any smaller.
    const timeout = Object.assign(new Error("canceling statement"), { code: "57014" });
    query
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 0 });

    const result = await purgeExpiredPromotions(14);
    expect(result.promotionsDeleted).toBe(5000);
    expect(result.capped).toBe(false);
    expect(result.batchSize).toBe(5000);
    expect(query.mock.calls[0]?.[1]).toEqual(["14", 20000]);
    expect(query.mock.calls[1]?.[1]).toEqual(["14", 5000]);
  });

  it("gives up rather than grind when even the smallest batch times out", async () => {
    // 500 promotions that cannot be deleted in thirty seconds is a sick
    // database, and a sweep that kept retrying would bury the signal.
    query.mockImplementation(() => {
      throw Object.assign(new Error("canceling statement"), { code: "57014" });
    });
    const err = await purgeExpiredPromotions(14).catch((e: unknown) => e);
    expect((err as Error).message).toBe("canceling statement");
    // 20000 -> 5000 -> 1250 -> 500, then the floor throws.
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("never swallows a fault that is not a timeout", async () => {
    query.mockImplementation(() => {
      throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
    });
    const err = await purgeExpiredPromotions(14).catch((e: unknown) => e);
    expect((err as Error).message).toBe("deadlock detected");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("deletes only what ended before the window", async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgeExpiredPromotions(14);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/end_ts < now\(\) - \(\$1 \|\| ' days'\)::interval/);
    // Never touches promotion_item directly: the FK cascade owns that, so a
    // promotion and its items can never be half-deleted.
    expect(sql).not.toMatch(/DELETE FROM promotion_item/i);
  });
});
