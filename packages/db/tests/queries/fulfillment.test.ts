import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { deactivateFulfillmentServicesExcept } from "../../src/queries/fulfillment.js";

describe("deactivating storefronts the catalogue no longer defines", () => {
  beforeEach(() => {
    query.mockClear();
  });

  it("refuses an empty keep-list instead of switching the product off", async () => {
    // In Postgres `slug = ANY('{}')` is always false, so `NOT (...)` is always
    // true and the WHERE clause collapses to `active` — one call would deactivate
    // every storefront and /mcp/online would report that nobody delivers anywhere.
    await expect(deactivateFulfillmentServicesExcept([], "curated")).rejects.toThrow(
      /empty keep-list/i,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps every slug it is given", async () => {
    await deactivateFulfillmentServicesExcept(
      ["shufersal-online", "rami-levy-online"],
      "curated",
    );
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(["shufersal-online", "rami-levy-online"]);
  });

  it("only retires rows the calling sync owns", async () => {
    // Two independent syncs write this table: the curated catalogue file and the
    // online scrape. Unscoped, each retired the other's storefronts, so the count
    // of delivery options /mcp/online reported was decided by whichever command
    // ran last, and flipped straight back on the next run.
    await deactivateFulfillmentServicesExcept(["shufersal-online"], "curated");
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("terms_source = $2");
    expect(params[1]).toBe("curated");
  });

  it("lets the scrape retire its own venues without touching the curated chains", async () => {
    await deactivateFulfillmentServicesExcept(["wolt-venue-1"], "scraped");
    expect(query.mock.calls[0]?.[1]?.[1]).toBe("scraped");
  });
});
