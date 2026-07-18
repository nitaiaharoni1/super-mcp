import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@super-mcp/db", () => ({
  reapReclassifiedListing: vi.fn(async () => {}),
  resolveProduct: vi.fn(async () => "product-1"),
  upsertChain: vi.fn(async () => {}),
  upsertListing: vi.fn(async () => "listing-1"),
  upsertPromotion: vi.fn(async () => "promo-1"),
  upsertStore: vi.fn(async () => "store-1"),
  upsertStorePrice: vi.fn(async () => {}),
  // Batch hot-path writers: build result maps from the inputs the same way the
  // real queries do, so a key-format mismatch in flushPrices fails the tests.
  bulkResolveProducts: vi.fn(
    async (rows: Array<{ gtin: string | null; sourceKey: string | null }>) =>
      new Map(rows.map((r) => [r.gtin ?? r.sourceKey, "product-1"])),
  ),
  bulkUpsertListings: vi.fn(
    async (rows: Array<{ chainId: string; itemCode: string }>) =>
      new Map(rows.map((r) => [`${r.chainId} ${r.itemCode}`, "listing-1"])),
  ),
  bulkUpsertStorePrices: vi.fn(async () => {}),
}));

import { bulkUpsertStorePrices, upsertChain, upsertPromotion } from "@super-mcp/db";
import type { RawPriceRecord, RawRecord } from "@super-mcp/shared";
import { Normalizer } from "../src/normalize.js";

function priceRecord(storeId: string): RawPriceRecord {
  return {
    kind: "price",
    chainId: "7290058140886",
    storeId,
    itemCode: "7290000173199",
    itemType: 1,
    name: "חלב 3%",
    qty: 1,
    unit: "ליטר",
    isWeighted: false,
    price: 6.9,
    allowDiscount: true,
    currency: "ILS",
    ts: new Date("2026-07-16T08:00:00Z"),
    raw: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Normalizer", () => {
  it("upserts each chain only once per run", async () => {
    const n = new Normalizer("test");
    await n.apply([priceRecord("001"), priceRecord("002")]);
    expect(upsertChain).toHaveBeenCalledTimes(1);
  });

  it("rethrows transient connection failures so the pipeline can retry the file", async () => {
    vi.mocked(upsertChain).mockRejectedValueOnce(
      new Error("Client is closed because Server sent FIN packet unexpectedly"),
    );
    const n = new Normalizer("test");
    await expect(n.apply([priceRecord("001")])).rejects.toThrow("Server sent FIN");
  });

  it("writes null unit_price (not the feed's mixed-scale value) when canonical unit math is unparseable", async () => {
    const record: RawPriceRecord = {
      ...priceRecord("001"),
      unit: "יחידות",
      qty: undefined,
      unitPrice: 12.34,
    };
    const n = new Normalizer("test");
    await n.apply([record]);
    // Flows through the batched writer; a lost row (e.g. a key-format mismatch
    // between listing upsert and price lookup) would send an empty array here.
    expect(bulkUpsertStorePrices).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ unitPrice: null })]),
    );
  });

  it("normalizes promo item codes the same way as listing item codes", async () => {
    const promo: RawRecord = {
      kind: "promo",
      chainId: "7290058140886",
      storeId: "001",
      promoId: "1234",
      description: "2 ב-30",
      mechanic: { type: "n_for_price", params: { n: 2, price: 30 }, rawText: "2 ב-30" },
      itemCodes: ["07290000173199", "INTERNAL-42"],
      startTs: new Date("2026-07-01T00:00:00Z"),
      endTs: new Date("2026-08-01T00:00:00Z"),
      clubOnly: false,
      ts: new Date(),
      raw: {},
    };
    const n = new Normalizer("test");
    const stats = await n.apply([promo]);
    expect(stats.rowsError).toBe(0);
    expect(upsertPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ itemCodes: ["7290000173199", "INTERNAL-42"] }),
    );
  });
});
