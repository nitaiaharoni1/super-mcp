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

  it("store filter includes chain-wide promotions (store_id IS NULL)", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ storeId: "22222222-2222-2222-2222-222222222222" });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/store_id IS NULL/);
  });
});
