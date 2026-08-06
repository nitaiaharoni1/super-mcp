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
import { classifyStoreKind, type RawRecord } from "@super-mcp/shared";
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
    // Only when the chain does not say otherwise — see the <StoreType> suite below.
    await ingest(
      storeRecord({ chainId: "7290058140886", storeId: "039", name: "מרלוג אינטרנט" }),
    );
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "warehouse" }),
    );
  });

  it("marks an order-picking depot, which is not a shop", async () => {
    // "ליקוט" is order picking. Tiv Taam files seven of these, all with no
    // address and no coordinates, and each one shadows a real branch of the same
    // name ("ליקוט רמת החייל" beside the actual רמת החייל on דבורה הנביאה 122).
    // A live basket recommended the depot as the shopper's first stop.
    await ingest(storeRecord({ chainId: "7290873255550", storeId: "801", name: "ליקוט רמת החייל" }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "online" }),
    );
  });

  it("does not mistake a word that merely starts with those letters", async () => {
    await ingest(storeRecord({ storeId: "802", name: "ליקוטי מרקט" }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "branch" }),
    );
  });

  it("decodes feed escaping so an address stays geocodable", async () => {
    // Rami Levy Ramat HaHayal filed "דבורה הנביאה 127&#x0D;". The trailing
    // carriage-return entity survived XML parsing and made the address
    // unresolvable, so the branch fell back to the Tel Aviv centroid — while the
    // Tiv Taam store on the SAME street (דבורה הנביאה 122) geocoded fine.
    await ingest(
      storeRecord({ storeId: "803", name: "רמת החייל", address: "דבורה הנביאה 127&#x0D;" }),
    );
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ address: "דבורה הנביאה 127" }),
    );
  });

  it("marks an ordinary branch as a branch", async () => {
    await ingest(storeRecord({ name: "רמת השרון" }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "branch" }),
    );
  });
});

/**
 * The Stores feed carries <StoreType>, the chain's own answer to the question
 * every rule above is trying to guess. It was parsed away for months.
 */
describe("<StoreType> from the feed", () => {
  withoutRegionFilter();

  it("stores the declared type so the guess can be audited against it", async () => {
    await ingest(storeRecord({ storeId: "413", name: "שופרסל ONLINE", storeType: 2 }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ feedStoreType: 2, storeKind: "online" }),
    );
  });

  it("believes the chain over the name: מרלוג אינטרנט is Rami Levy's online store", async () => {
    // 15,790 prices, and the storefront behind rami-levy.co.il. "מרלוג" is the
    // right word for a depot that restocks branches and the wrong one for a shop
    // that ships to customers. Read as a warehouse, Rami Levy is simply absent
    // from every online query.
    await ingest(
      storeRecord({
        chainId: "7290058140886",
        storeId: "039",
        name: "מרלוג אינטרנט",
        storeType: 2,
      }),
    );
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "online" }),
    );
  });

  it("keeps a type-3 shop shoppable without a hand-carved exception", async () => {
    // Keshet 103 files "חורב 15 | www.kulinarik.co.il/|" and is a real branch.
    // Migration 024 had to spell out that a URL inside an address is not proof
    // of an online store. Type 3 — both — says it directly.
    await ingest(
      storeRecord({
        chainId: "7290785400000",
        storeId: "103",
        name: "קולינריק חורב",
        address: "חורב 15 | www.kulinarik.co.il/|",
        storeType: 3,
      }),
    );
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "branch" }),
    );
  });

  it("still calls a type-2 collection point a pickup, not a delivery storefront", async () => {
    // The schema has no code for "collect it yourself", so both arrive as type 2
    // — but a shopper has to drive to one of them.
    await ingest(storeRecord({ storeId: "150", name: "הדרים פיקאפ", storeType: 2 }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "pickup" }),
    );
  });

  it("does not let a type-1 declaration turn a distribution centre into a shop", async () => {
    // There is no warehouse code, so a chain filing a depot has to call it
    // type 1. Ranking one as a branch is the wasted-trip bug this all exists
    // to prevent.
    await ingest(storeRecord({ storeId: "900", name: "מרכז הפצה ראשל\"צ", storeType: 1 }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeKind: "warehouse" }),
    );
  });

  it("leaves the type unset when the chain omits the element", async () => {
    await ingest(storeRecord({ name: "רמת השרון" }));
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ feedStoreType: undefined, storeKind: "branch" }),
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

/**
 * A store invented from a price row, when the venue's own page never arrived.
 *
 * The stub carried no name and no type, so `classifyStoreKind` had nothing but
 * an English slug to go on and filed the venue as a walk-in branch. Two Wolt
 * venues sat in production that way, "Store victory-ashdod" and
 * "Store machsanei-hashuk-kiryat-malachi", scraped nightly and reachable by
 * nobody, because the online filter that decides what to download reads exactly
 * that field.
 */
describe("stub stores invented from a price row", () => {
  withoutRegionFilter();

  const priceRecord = (chainId: string, storeId: string): RawRecord =>
    ({
      kind: "price",
      chainId,
      storeId,
      itemCode: "7290000000001",
      itemType: 1,
      name: "חלב 3%",
      price: 6.9,
      sourceTs: new Date("2026-08-06T00:00:00Z"),
      raw: {},
    }) as RawRecord;

  it("files a scraped venue as a storefront, not a branch", async () => {
    const n = new Normalizer("il-wolt");
    await n.apply([priceRecord("IL-WOLT-VICTORY", "victory-ashdod")]);
    // upsertStore derives the kind from this, and 2 is the only value that
    // survives a name the classifier would otherwise read as a warehouse.
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({
        storeCode: "victory-ashdod",
        feedStoreType: 2,
        priceSource: "scraped",
      }),
    );
    expect(classifyStoreKind("Store victory-ashdod", undefined, 2)).toBe("online");
  });

  it("leaves a feed stub a branch, because those really are branches", async () => {
    // PublishPrice portals publish real branches and no Stores file. Calling
    // those online would be the same bug pointed the other way.
    const n = new Normalizer("il-cerberus");
    await n.apply([priceRecord(YOHANANOF, "550")]);
    expect(upsertStore).toHaveBeenCalledWith(
      expect.objectContaining({ storeCode: "550", feedStoreType: undefined }),
    );
  });
});
