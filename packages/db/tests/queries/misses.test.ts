import { describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { recordMisses } from "../../src/queries/misses.js";

describe("recordMisses", () => {
  it("upserts one row per miss with additive counts", async () => {
    query.mockClear();
    await recordMisses([
      { kind: "promo_other", term: "מבצע מסתורי", count: 3 },
      { kind: "unit_unparseable", term: "תיבה|" },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![1]).toEqual(["promo_other", "מבצע מסתורי", "{}", 3]);
    expect(query.mock.calls[1]![1]).toEqual(["unit_unparseable", "תיבה|", "{}", 1]);
  });

  it("skips empty terms and no-ops on empty input", async () => {
    query.mockClear();
    await recordMisses([{ kind: "promo_other", term: "   " }]);
    await recordMisses([]);
    expect(query).not.toHaveBeenCalled();
  });
});
