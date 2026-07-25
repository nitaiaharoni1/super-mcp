import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@super-mcp/db", () => ({
  reapReclassifiedListing: vi.fn(async () => {}),
  recordMisses: vi.fn(async () => {}),
  resolveProduct: vi.fn(async () => "product-1"),
  upsertChain: vi.fn(async () => {}),
  upsertListing: vi.fn(async () => "listing-1"),
  upsertPromotion: vi.fn(async () => "promo-1"),
  upsertStore: vi.fn(async () => "store-1"),
  upsertStorePrice: vi.fn(async () => {}),
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

import * as db from "@super-mcp/db";
import type { RawRecord } from "@super-mcp/shared";
import { Normalizer } from "../src/normalize.js";

const upsertStore = vi.mocked(db.upsertStore);

/** Yohananof's chain id — the chain whose feed omits <City> entirely. */
const YOHANANOF = "7290803800003";

function storeRecord(over: Partial<Extract<RawRecord, { kind: "store" }>> = {}): RawRecord {
  return {
    kind: "store",
    chainId: YOHANANOF,
    storeId: "026",
    name: "רמת השרון",
    raw: {},
    ...over,
  } as RawRecord;
}

async function ingest(record: RawRecord): Promise<void> {
  const n = new Normalizer("il-cerberus");
  await n.apply([record]);
}

beforeEach(() => vi.clearAllMocks());

/**
 * Store-kind classification is orthogonal to coverage policy, and the fulfilment
 * endpoints under test sit outside the ingest region (or have no locality at
 * all), so the region filter would drop them before the upsert. Disable it for
 * these cases; region behaviour has its own suite in regions.test.ts.
 */
function withoutRegionFilter(): void {
  const previous = process.env.SUPER_MCP_REGION_FILTER;
  beforeEach(() => {
    process.env.SUPER_MCP_REGION_FILTER = "0";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.SUPER_MCP_REGION_FILTER;
    else process.env.SUPER_MCP_REGION_FILTER = previous;
  });
}

describe("store city recovery at ingest", () => {
  it("recovers the locality from the branch name when the feed omits <City>", async () => {
    // Without this the row is city-less, and BOTH geocode tiers key on
    // store.city — so the branch can never get coordinates and is invisible to
    // every location-scoped query.
    await ingest(storeRecord({ name: "רמת השרון", city: undefined }));

    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ city: "רמת השרון" }),
    );
  });

  it("strips a neighborhood suffix down to the locality", async () => {
    await ingest(storeRecord({ storeId: "073", name: "חולון המרכבה", city: undefined }));
    expect(upsertStore).toHaveBeenCalledWith(expect.objectContaining({ city: "חולון" }));
  });

  it("prefers the feed's own city over the name", async () => {
    await ingest(storeRecord({ name: "רמת השרון", city: "הרצליה" }));
    expect(upsertStore).toHaveBeenCalledWith(expect.objectContaining({ city: "הרצליה" }));
  });

  it("canonicalizes a CBS locality code from the feed", async () => {
    await ingest(storeRecord({ name: "סניף", city: "6400" }));
    expect(upsertStore).toHaveBeenCalledWith(expect.objectContaining({ city: "הרצליה" }));
  });

  describe("with coverage filtering disabled", () => {
    withoutRegionFilter();

    it("leaves the city undefined when nothing is recoverable", async () => {
      // "Store 799" is a placeholder; inventing a city would be worse than none.
      await ingest(storeRecord({ storeId: "799", name: "Store 799", city: undefined }));
      expect(upsertStore).toHaveBeenCalledWith(expect.objectContaining({ city: undefined }));
    });
  });

  it("counts name-recovered cities separately from feed-supplied ones", async () => {
    const n = new Normalizer("il-cerberus");
    const stats = await n.apply([
      storeRecord({ storeId: "026", name: "רמת השרון", city: undefined }),
      storeRecord({ storeId: "024", name: "כפר סבא", city: undefined }),
      storeRecord({ storeId: "030", name: "נתניה", city: "נתניה" }),
    ]);
    expect(stats.storeCityFromName).toBe(2);
  });
});

describe("store kind at ingest", () => {
  withoutRegionFilter();

  it("marks an online storefront so it is never ranked as a shoppable branch", async () => {
    await ingest(
      storeRecord({ chainId: "7290027600007", storeId: "413", name: "שופרסל ONLINE" }),
    );
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "online" }),
    );
  });

  it("marks a pickup point", async () => {
    await ingest(storeRecord({ storeId: "152", name: "גדרה פיק אפ" }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "pickup" }),
    );
  });

  it("marks a logistics warehouse ahead of its online marker", async () => {
    await ingest(
      storeRecord({ chainId: "7290058140886", storeId: "039", name: "מרלוג אינטרנט" }),
    );
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "warehouse" }),
    );
  });

  it("marks an ordinary branch as a branch", async () => {
    await ingest(storeRecord({ name: "רמת השרון" }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "branch" }),
    );
  });
});

describe("price rows tracked per store for reconciliation", () => {
  it("counts written price rows against their store uuid", async () => {
    const n = new Normalizer("il-cerberus");
    const stats = await n.apply([
      {
        kind: "price",
        chainId: YOHANANOF,
        storeId: "026",
        itemCode: "7290000173199",
        itemType: 1,
        name: "חלב 3%",
        qty: 1,
        unit: "ליטר",
        isWeighted: false,
        price: 6.9,
        currency: "ILS",
        ts: new Date("2026-07-25T06:00:00Z"),
        raw: {},
      } as RawRecord,
    ]);

    expect(stats.pricesByStore.get("store-1")).toBe(1);
  });
});
