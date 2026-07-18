import { describe, expect, it, vi } from "vitest";

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

import { getReadiness } from "../../../src/services/readiness/getReadiness.js";

describe("getReadiness", () => {
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
});
