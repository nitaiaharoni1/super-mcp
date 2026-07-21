import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

describe("listPromotions SQL", () => {
  beforeEach(() => query.mockClear());

  it("sends a real \\D regex to Postgres (JS must not eat the backslash)", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ productId: "11111111-1111-1111-1111-111111111111" });
    const sql = query.mock.calls[0]![0] as string;
    // The string Postgres receives must contain backslash-D, not bare D.
    expect(sql).toContain(String.raw`'\D'`);
  });

  it("materializes product item codes before joining promotions", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ productId: "11111111-1111-1111-1111-111111111111" });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/WITH product_codes AS/);
    expect(sql).toMatch(/l\.product_id = \$2/);
  });

  it("store filter includes chain-wide promotions (store_id IS NULL)", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ storeId: "22222222-2222-2222-2222-222222222222" });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/store_id IS NULL/);
  });

  it("defaults the limit to 50 when none is given", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({});
    const params = query.mock.calls[0]![1] as unknown[];
    // limit is the 5th bind param.
    expect(params[4]).toBe(50);
  });

  it("respects an explicit limit and clamps it to 1..200", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ limit: 10 });
    expect((query.mock.calls[0]![1] as unknown[])[4]).toBe(10);

    query.mockClear();
    await listPromotions({ limit: 9999 });
    expect((query.mock.calls[0]![1] as unknown[])[4]).toBe(200);

    query.mockClear();
    await listPromotions({ limit: 0 });
    expect((query.mock.calls[0]![1] as unknown[])[4]).toBe(1);
  });

  it("applies the LIMIT to promotion rows first via a page CTE", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ limit: 10 });
    const sql = query.mock.calls[0]![0] as string;
    // The LIMIT lives inside the page CTE (before item_code aggregation), not on the outer query.
    expect(sql).toMatch(/WITH page AS/);
    const cte = sql.slice(sql.indexOf("WITH page"), sql.indexOf("array_remove"));
    expect(cte).toMatch(/LIMIT \$5/);
  });

  it("orders by soonest end date with a deterministic tie-break", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({});
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/ORDER BY pr\.end_ts ASC, pr\.id/);
    expect(sql).not.toMatch(/start_ts DESC/);
  });

  it("filters by city via a store city-key join", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ city: "הרצליה" });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/s\.city = ANY\(\$4::text\[\]\)/);
    // City filter also covers chain-wide promos of chains present in that city.
    expect(sql).toMatch(/pr\.store_id IS NULL AND s\.chain_id = pr\.chain_id/);
    // The bound city param is a non-empty match-key array.
    const cityParam = (query.mock.calls[0]![1] as unknown[])[3] as string[];
    expect(Array.isArray(cityParam)).toBe(true);
    expect(cityParam.length).toBeGreaterThan(0);
  });

  it("passes null for city when unset", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({});
    expect((query.mock.calls[0]![1] as unknown[])[3]).toBeNull();
  });
});
