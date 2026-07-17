import { describe, expect, it, vi } from "vitest";

vi.mock("@super-mcp/db", () => ({
  reapReclassifiedListing: vi.fn(),
  recordMisses: vi.fn(),
  resolveProduct: vi.fn().mockResolvedValue("product-uuid"),
  upsertChain: vi.fn(),
  upsertListing: vi.fn().mockResolvedValue("listing-uuid"),
  upsertPromotion: vi.fn(),
  upsertStore: vi.fn().mockResolvedValue("store-uuid"),
  upsertStorePrice: vi.fn(),
}));

import type { RawRecord } from "@super-mcp/shared";
import { Normalizer } from "../src/normalize.js";

describe("normalize telemetry counters", () => {
  it("counts promo mechanics that fall back to other", async () => {
    const n = new Normalizer("test");
    const records: RawRecord[] = [
      {
        kind: "promo",
        chainId: "7290027600007",
        storeId: "001",
        promoId: "p1",
        description: "מבצע מסתורי",
        mechanic: { type: "other", params: {}, rawText: "מבצע מסתורי" },
        itemCodes: ["7290000000001"],
        startTs: new Date(),
        endTs: new Date(),
        ts: new Date(),
      },
    ];
    const stats = await n.apply(records);
    expect(stats.promoOther).toBe(1);
  });

  it("counts unparseable units on price rows", async () => {
    const n = new Normalizer("test");
    const records: RawRecord[] = [
      {
        kind: "price",
        chainId: "7290027600007",
        storeId: "001",
        itemCode: "7290000000001",
        itemType: 1,
        name: "מוצר",
        qty: 1,
        unit: "zzz",
        price: 10,
        ts: new Date(),
      },
    ];
    const stats = await n.apply(records);
    expect(stats.unitUnparseable).toBe(1);
  });
});
