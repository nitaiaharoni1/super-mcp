import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { healSizeUnitFamily } from "../../src/queries/products.js";

describe("healSizeUnitFamily", () => {
  beforeEach(() => query.mockReset());

  it("flips only rows whose g/ml family conflicts with the name at equal quantity", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          // Conflict: bottle named liters, stored grams → should flip to ml.
          { id: "cola", name: "קוקה קולה 1.5 ליטר", size_qty: "1500", size_unit: "g" },
          // Conflict the other way: solid named grams, stored ml → flip to g.
          { id: "sauce", name: "רוטב צילי 700 גרם", size_qty: "700", size_unit: "ml" },
          // No name volume → left alone.
          { id: "plain", name: "חטיף", size_qty: "100", size_unit: "g" },
          // Name agrees with stored family → left alone.
          { id: "ok", name: "שוקולד 100 גרם", size_qty: "100", size_unit: "g" },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 2 });

    const result = await healSizeUnitFamily();

    expect(result).toEqual({ scanned: 4, healed: 2 });
    expect(query).toHaveBeenCalledTimes(2);
    const [, params] = query.mock.calls[1]!;
    expect(params).toEqual([
      ["cola", "sauce"],
      [1500, 700],
      ["ml", "g"],
    ]);
  });

  it("is a no-op when no row conflicts (idempotent re-run)", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "ok", name: "מים 1.5 ליטר", size_qty: "1500", size_unit: "ml" }],
    });

    const result = await healSizeUnitFamily();

    expect(result).toEqual({ scanned: 1, healed: 0 });
    expect(query).toHaveBeenCalledTimes(1); // no UPDATE issued
  });
});
