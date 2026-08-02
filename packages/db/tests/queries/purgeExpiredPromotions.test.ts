import { describe, expect, it, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { purgeExpiredPromotions } from "../../src/queries/promotions.js";

describe("sweeping promotions that finished", () => {
  beforeEach(() => query.mockReset());

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
    expect(result.promotionsDeleted).toBe(200 * 20000);
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
