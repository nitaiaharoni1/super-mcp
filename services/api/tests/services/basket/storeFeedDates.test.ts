/**
 * How old a storefront's prices are, and why it is a store-level question.
 *
 * `max(source_ts) GROUP BY store_id` cannot be served from an index, so every
 * call reads the whole price table. The answer moves once a night when an ingest
 * lands, so running it per request is pure waste; the cache is the point of the
 * function, not an optimisation bolted onto it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@super-mcp/db", () => ({ query }));
vi.mock("../../../src/services/promotions/index.js", () => ({
  getActivePromotionsForListings: vi.fn(),
}));

const { loadStoreFeedDates, _resetStoreFeedDatesForTests } = await import(
  "../../../src/services/basket/loadPricingData.js"
);

const NOW = new Date("2026-08-07T12:00:00Z");
const rows = [
  { store_id: "store-a", newest_source_ts: new Date("2026-08-06T00:40:00Z") },
  { store_id: "store-b", newest_source_ts: new Date("2026-07-29T02:05:00Z") },
];

beforeEach(() => {
  query.mockReset();
  _resetStoreFeedDatesForTests();
});

describe("loadStoreFeedDates", () => {
  it("returns the newest price date each store's retailer published", async () => {
    query.mockResolvedValue({ rows });

    const byStore = await loadStoreFeedDates(NOW);

    expect(byStore.get("store-a")).toEqual(new Date("2026-08-06T00:40:00Z"));
    expect(byStore.get("store-b")).toEqual(new Date("2026-07-29T02:05:00Z"));
    expect(byStore.get("store-never-priced")).toBeUndefined();
  });

  it("reads the table once inside the cache window", async () => {
    query.mockResolvedValue({ rows });

    await loadStoreFeedDates(NOW);
    await loadStoreFeedDates(new Date(NOW.getTime() + 60_000));

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reads it again once the window has passed", async () => {
    query.mockResolvedValue({ rows });

    await loadStoreFeedDates(NOW);
    await loadStoreFeedDates(new Date(NOW.getTime() + 6 * 60_000));

    expect(query).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent callers onto one scan", async () => {
    query.mockResolvedValue({ rows });

    const [first, second] = await Promise.all([
      loadStoreFeedDates(NOW),
      loadStoreFeedDates(NOW),
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("answers empty rather than failing the basket", async () => {
    // Freshness annotates a result. It must never be the reason a shopper gets
    // no result at all.
    query.mockRejectedValue(new Error("statement timeout"));

    await expect(loadStoreFeedDates(NOW)).resolves.toEqual(new Map());
  });

  it("retries after a failure instead of caching the emptiness", async () => {
    query.mockRejectedValueOnce(new Error("statement timeout")).mockResolvedValue({ rows });

    await loadStoreFeedDates(NOW);
    const second = await loadStoreFeedDates(NOW);

    expect(second.get("store-a")).toEqual(new Date("2026-08-06T00:40:00Z"));
  });
});
