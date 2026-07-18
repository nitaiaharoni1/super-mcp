import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [{ id: "store-id" }] });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { upsertStore } from "../../src/queries/chains.js";

describe("upsertStore coordinate integrity", () => {
  beforeEach(() => query.mockClear());

  it("normalizes invalid incoming coordinates to null", async () => {
    await upsertStore({
      chainId: "chain-1",
      storeCode: "17",
      name: "Herzliya",
      lat: 0,
      lng: 34.84,
    });

    expect(query.mock.calls[0]?.[1]).toEqual([
      "chain-1",
      "17",
      "Herzliya",
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("updates coordinate pairs atomically without replacing valid stored geo with null", async () => {
    await upsertStore({
      chainId: "chain-1",
      storeCode: "17",
      name: "Herzliya",
      lat: 32.16,
      lng: 34.84,
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("WHEN EXCLUDED.lat IS NOT NULL AND EXCLUDED.lng IS NOT NULL");
    expect(sql).toContain("ELSE store.lat");
    expect(sql).toContain("ELSE store.lng");
  });
});
