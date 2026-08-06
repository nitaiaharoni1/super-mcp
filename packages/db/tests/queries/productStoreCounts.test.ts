/**
 * The popularity signal search ranks on, and the half of it that never ran.
 *
 * `refreshProductStoreCounts` recomputes `store_count` from an aggregate over
 * priced listings. A product with no priced listing has no row in that
 * aggregate, so an `UPDATE ... FROM (aggregate) WHERE c.product_id = p.id`
 * cannot reach it: its old count survives untouched, forever.
 *
 * Delisting one SKU at one store hid this for as long as it existed, because the
 * counts only ever drifted by one and the product still had prices elsewhere.
 * Narrowing the ingest to online storefronts did not: it stranded 91,718
 * products holding a score earned across hundreds of branches that no longer
 * price them, all of them ranking above the products a shopper can buy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../src/queries/query.js", () => ({ query }));

const { refreshProductStoreCounts } = await import("../../src/queries/products.js");

beforeEach(() => {
  query.mockReset();
});

/** The SQL text of the nth call, whitespace-collapsed for matching. */
function sqlOf(call: number): string {
  return String(query.mock.calls[call]?.[0] ?? "").replace(/\s+/g, " ");
}

describe("refreshProductStoreCounts", () => {
  it("zeroes products that no longer have a single priced listing", async () => {
    query.mockResolvedValueOnce({ rowCount: 3 }).mockResolvedValueOnce({ rowCount: 7 });

    const result = await refreshProductStoreCounts();

    expect(query).toHaveBeenCalledTimes(2);
    const zeroing = sqlOf(1);
    expect(zeroing).toContain("SET store_count = 0, branch_store_count = 0");
    expect(zeroing).toContain("NOT EXISTS");
    // Both counts, or the two disagree and the physical filter keeps a product
    // the recompute already said is nowhere.
    expect(zeroing).toContain("branch_store_count = 0");
  });

  it("reports every row it changed, not just the recomputed ones", async () => {
    // The count is what an ingest logs. Reporting only the first pass made a run
    // that corrected 91,718 stale scores look like it corrected none.
    query.mockResolvedValueOnce({ rowCount: 3 }).mockResolvedValueOnce({ rowCount: 7 });
    await expect(refreshProductStoreCounts()).resolves.toEqual({ updated: 10 });
  });

  it("touches nothing on a second run", async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await expect(refreshProductStoreCounts()).resolves.toEqual({ updated: 0 });
  });

  it("skips rows already at zero, so a quiet run stays quiet", async () => {
    // Without the guard every never-priced product is rewritten on every ingest,
    // which is a write amplification the nightly job cannot afford.
    query.mockResolvedValue({ rowCount: 0 });
    await refreshProductStoreCounts();
    expect(sqlOf(1)).toContain("p.store_count <> 0 OR p.branch_store_count <> 0");
  });
});
