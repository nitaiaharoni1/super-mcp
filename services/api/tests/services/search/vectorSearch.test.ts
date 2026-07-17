import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { searchByQueryVector } from "../../../src/services/search/vectorSearch.js";

describe("searchByQueryVector", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("maps ANN rows to vector hits with score from distance", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: "p1",
          gtin: null,
          name: "Nearest",
          brand: null,
          category_l1: null,
          category_l2: null,
          size_qty: null,
          size_unit: null,
          vector_distance: 0.2,
          has_price: true,
          has_local_price: false,
          score: 0,
          matched_via: "vector",
        },
      ],
    });

    const vector = Array.from({ length: 384 }, () => 0);
    const hits = await searchByQueryVector({
      vector,
      model: "test-model",
      limit: 10,
      maxDistance: 0.45,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/pe\.embedding <=> \$1::vector/);
    expect(sql).toMatch(/ORDER BY pe\.embedding <=> \$1::vector/);
    expect(params[1]).toBe("test-model");
    expect(params[2]).toBe(0.45);
    expect(params[3]).toBe(10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedVia).toBe("vector");
    expect(hits[0]?.vectorDistance).toBe(0.2);
    expect(hits[0]?.score).toBeCloseTo(0.8);
    expect(hits[0]?.hasPrice).toBe(true);
  });
});
