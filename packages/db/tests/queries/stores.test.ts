import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { knownStoreLocationsForChain } from "../../src/queries/stores.js";

describe("knownStoreLocationsForChain", () => {
  beforeEach(() => {
    query.mockClear();
  });

  it("only trusts stores the feed has confirmed recently", async () => {
    // The hints are a memory of a working feed, not a permanent record. A store
    // that closed stops being upserted, so without a bound it would be hinted
    // and logged as restored on every run forever, burying the one night the
    // backstop actually mattered.
    await knownStoreLocationsForChain("7290058140886");

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("updated_at > now() - make_interval(days => $2::int)");
    expect(query.mock.calls[0]?.[1]).toEqual(["7290058140886", 30]);
  });

  it("carries the store kind and StoreType through, not just the location", async () => {
    // The online filter runs on these same hints: drop store_kind and a delivery
    // depot named like a warehouse stops being priced the moment its feed hiccups.
    const sql = String(
      (await knownStoreLocationsForChain("c"), query.mock.calls[0]?.[0]),
    );
    expect(sql).toContain("feed_store_type");
    expect(sql).toContain("store_kind");
  });
});
