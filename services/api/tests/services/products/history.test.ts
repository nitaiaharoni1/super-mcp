import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

describe("getProductHistory window", () => {
  beforeEach(() => query.mockReset());

  it("selects the NEWEST 5000 rows but returns them oldest-first", async () => {
    const rows = [
      {
        store_id: "s1",
        store_name: "A",
        chain_id: "c1",
        price: "2",
        unit_price: null,
        currency: "ILS",
        source_ts: new Date("2026-07-02"),
      },
      {
        store_id: "s1",
        store_name: "A",
        chain_id: "c1",
        price: "1",
        unit_price: null,
        currency: "ILS",
        source_ts: new Date("2026-07-01"),
      },
    ];
    query.mockResolvedValue({ rows }); // DESC order, as Postgres will return it
    const { getProductHistory } = await import(
      "../../../src/services/products/history.js"
    );
    const out = await getProductHistory("p1", {});
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/ORDER BY pp\.source_ts DESC/);
    // API output stays chronological (oldest first).
    expect(out.map((r) => r.sourceTs)).toEqual([
      new Date("2026-07-01"),
      new Date("2026-07-02"),
    ]);
  });
});
