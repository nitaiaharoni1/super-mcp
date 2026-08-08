import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { purgeIdleQueryEmbeddings, purgeOldUsageEvents } from "../../src/queries/retention.js";

/** Braces matter: a value returned from beforeEach is taken as the teardown callback. */
beforeEach(() => {
  query.mockReset();
});

describe("usage retention", () => {
  it("keeps sweeping until a batch comes back empty", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 20000 })
      .mockResolvedValueOnce({ rowCount: 42 })
      .mockResolvedValueOnce({ rowCount: 0 });

    const result = await purgeOldUsageEvents(90);

    expect(result.deleted).toBe(20042);
    expect(result.capped).toBe(false);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("passes the window through rather than a hardcoded one", async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await purgeOldUsageEvents(30);

    expect(query.mock.calls[0]?.[1]).toEqual(["30", 20000]);
  });

  it("targets usage_event and nothing adjacent", async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await purgeOldUsageEvents(90);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("DELETE FROM usage_event");
    expect(sql).not.toMatch(/access_requests/);
  });
});

describe("search phrase retention", () => {
  it("ages phrases out on embedded_at, which a cache hit does not refresh", async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await purgeIdleQueryEmbeddings(180);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("DELETE FROM semantic_query_embedding");
    expect(sql).toContain("embedded_at <");
    // Ageing on hits would keep a popular phrase on file forever, which is the
    // opposite of what this sweep is for.
    expect(sql).not.toMatch(/\bhits\b/);
  });

  it("deletes on the full primary key, so one model's row cannot take another's", async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await purgeIdleQueryEmbeddings(180);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("s.query_hash = d.query_hash");
    expect(sql).toContain("s.model = d.model");
  });
});

describe("a database in trouble", () => {
  it("backs off a timed-out batch instead of giving up for the night", async () => {
    const timeout = Object.assign(new Error("canceling statement"), { code: "57014" });
    query.mockRejectedValueOnce(timeout).mockResolvedValueOnce({ rowCount: 0 });

    const result = await purgeOldUsageEvents(90);

    expect(result.batchSize).toBe(5000);
    expect(result.capped).toBe(false);
  });

  it("propagates a real fault rather than sweeping past it", async () => {
    query.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "42501" }));

    await expect(purgeOldUsageEvents(90)).rejects.toThrow(/permission denied/);
  });
});
