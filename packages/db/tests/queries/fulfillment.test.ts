import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { deactivateFulfillmentServicesExcept } from "../../src/queries/fulfillment.js";

describe("deactivating storefronts the catalogue no longer defines", () => {
  beforeEach(() => query.mockClear());

  it("refuses an empty keep-list instead of switching the product off", async () => {
    // In Postgres `slug = ANY('{}')` is always false, so `NOT (...)` is always
    // true and the WHERE clause collapses to `active` — one call would deactivate
    // every storefront and /mcp/online would report that nobody delivers anywhere.
    await expect(deactivateFulfillmentServicesExcept([])).rejects.toThrow(/empty keep-list/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps every slug it is given", async () => {
    await deactivateFulfillmentServicesExcept(["shufersal-online", "rami-levy-online"]);
    expect(query.mock.calls[0]?.[1]).toEqual([["shufersal-online", "rami-levy-online"]]);
  });
});
