import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

const getProductById = vi.fn();
vi.mock("../../../src/services/products/index.js", () => ({
  getProductById: (...args: unknown[]) => getProductById(...args),
}));

describe("suggestSubstitutes candidate SQL", () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    getProductById.mockReset();
  });

  it("ranks the candidate pool by relevance before LIMIT, not by UUID", async () => {
    getProductById.mockResolvedValue({
      id: "p1",
      gtin: null,
      name: "מוצר",
      brand: null,
      categoryL1: "cat1",
      categoryL2: null,
      sizeQty: 100,
      sizeUnit: "g",
    });
    const { suggestSubstitutes } = await import(
      "../../../src/services/substitutes/suggestSubstitutes.js"
    );
    await suggestSubstitutes("p1", {});
    const candidateSql = query.mock.calls.at(-1)![0] as string;
    expect(candidateSql).toMatch(
      /ORDER BY\s+c\.same_category DESC,\s*c\.name_sim DESC,\s*c\.unit_price ASC/,
    );
  });
});
