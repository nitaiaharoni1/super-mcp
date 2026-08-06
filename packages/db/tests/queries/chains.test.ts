import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [{ id: "store-id" }] });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { upsertChain, upsertStore } from "../../src/queries/chains.js";

describe("upsertStore coordinate integrity", () => {
  beforeEach(() => {
    query.mockClear();
  });

  it("normalizes invalid incoming coordinates to null and leaves geo_source null", async () => {
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
      null, // geo_source: no valid feed coords → left for the geocoder
      "branch", // store_kind: derived from name+address
      null, // feed_store_type: this caller supplied no <StoreType>
      "feed", // price_source: a regulated filing unless a scraper says otherwise
    ]);
  });

  it("records that a store's prices were scraped rather than filed", async () => {
    // A scraped price and a price filed under the transparency law are not the
    // same claim, and a chain can have both: Victory files branches AND runs a
    // stor.ai storefront we read off the web.
    await upsertStore({
      chainId: "7290696200003",
      storeCode: "2930",
      name: "אינטרנט",
      feedStoreType: 2,
      priceSource: "scraped",
    });
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[9]).toBe("online");
    expect(params[11]).toBe("scraped");
  });

  it("does not let a price-file stub silently downgrade a scraped store", async () => {
    // 'feed' is the column default, so it is also what a caller that forgot to
    // pass provenance sends. Losing the flag that way is silent and makes a
    // scraped price indistinguishable from a filed one.
    await upsertStore({ chainId: "c", storeCode: "1", name: "Store 1" });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("WHEN store.price_source = 'scraped' AND EXCLUDED.price_source = 'feed'");
    expect(sql).toContain("EXCLUDED.name ~ '^Store[[:space:]]' THEN store.price_source");
  });

  it("persists the chain's declared <StoreType> and classifies from it", async () => {
    // The feed's own answer outranks the name. "מרלוג אינטרנט" reads as a
    // warehouse and is Rami Levy's online store; type 2 says so directly.
    await upsertStore({
      chainId: "7290058140886",
      storeCode: "039",
      name: "מרלוג אינטרנט",
      feedStoreType: 2,
    });

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[9]).toBe("online");
    expect(params[10]).toBe(2);
  });

  it("tags valid incoming feed coordinates with geo_source 'feed'", async () => {
    await upsertStore({
      chainId: "chain-1",
      storeCode: "17",
      name: "Herzliya",
      lat: 32.16,
      lng: 34.84,
    });

    expect(query.mock.calls[0]?.[1]?.[8]).toBe("feed");
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

  it("preserves a geocoded point's provenance on reingest, and re-geocodes only on address change", async () => {
    await upsertStore({
      chainId: "chain-1",
      storeCode: "17",
      name: "Herzliya",
    });

    const sql = String(query.mock.calls[0]?.[0]);
    // Feed coords win and are labelled 'feed'; otherwise a changed address resets
    // provenance to NULL so the address geocoder re-runs; else keep what we have.
    expect(sql).toContain("THEN 'feed'");
    expect(sql).toContain("EXCLUDED.address IS DISTINCT FROM store.address");
    expect(sql).toContain("ELSE store.geo_source");
  });
});

describe("upsertStore store_kind", () => {
  beforeEach(() => {
    query.mockClear();
  });

  const kindOf = (): unknown => query.mock.calls[0]?.[1]?.[9];

  it("derives the kind from the name when the caller omits it", async () => {
    await upsertStore({ chainId: "c", storeCode: "413", name: "שופרסל ONLINE" });
    expect(kindOf()).toBe("online");
  });

  it("classifies a logistics warehouse ahead of its online marker", async () => {
    // "מרלוג אינטרנט" says internet but is a distribution centre, not a storefront.
    await upsertStore({ chainId: "c", storeCode: "039", name: "מרלוג אינטרנט" });
    expect(kindOf()).toBe("warehouse");
  });

  it("classifies a pickup point from its name", async () => {
    await upsertStore({ chainId: "c", storeCode: "152", name: "גדרה פיק אפ" });
    expect(kindOf()).toBe("pickup");
  });

  it("derives the kind from the address when the name is neutral", async () => {
    await upsertStore({
      chainId: "c",
      storeCode: "471",
      name: "קרפור כפר סבא",
      address: "משלוח עד הבית",
    });
    expect(kindOf()).toBe("online");
  });

  it("honours an explicit kind from the caller", async () => {
    await upsertStore({
      chainId: "c",
      storeCode: "1",
      name: "סניף רגיל",
      storeKind: "pickup",
    });
    expect(kindOf()).toBe("pickup");
  });

  it("keeps a confirmed storefront when today's row lost its <StoreType>", async () => {
    // The night the feed drops <StoreType>, "מרלוג אינטרנט" re-derives as
    // 'warehouse' from its name. Overwriting the stored 'online' would make the
    // next run skip the store as not orderable and silently lose the chain's
    // delivery catalogue, which is exactly what the ingestion backstop exists
    // to prevent.
    await upsertStore({ chainId: "c", storeCode: "039", name: "מרלוג אינטרנט" });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(kindOf()).toBe("warehouse");
    expect(sql).toContain(
      "WHEN store.feed_store_type IS NOT NULL\n           AND store.store_kind IN ('online', 'pickup') THEN store.store_kind",
    );
  });

  it("never lets a 'Store NNN' price-file stub downgrade an identified storefront", async () => {
    await upsertStore({ chainId: "c", storeCode: "413", name: "Store 413" });
    const sql = String(query.mock.calls[0]?.[0]);
    // A stub classifies as 'branch'; the guard keeps the stored kind instead.
    expect(kindOf()).toBe("branch");
    expect(sql).toContain("WHEN EXCLUDED.store_kind <> 'branch' THEN EXCLUDED.store_kind");
    expect(sql).toContain("WHEN EXCLUDED.name ~ '^Store[[:space:]]' THEN store.store_kind");
  });
});

describe("upsertChain source_id ownership", () => {
  beforeEach(() => {
    query.mockClear();
  });

  it("lets a real source take over a fixture-owned chain but never the reverse", async () => {
    await upsertChain({
      id: "7290027600007",
      sourceId: "il-shufersal",
      market: "IL",
      nameHe: "שופרסל",
    });
    const sql = String(query.mock.calls[0]?.[0]);
    // Only an incoming FIXTURE defers to the stored value; a real source overwrites.
    expect(sql).toContain("WHEN EXCLUDED.source_id = 'il-fixture'");
    expect(sql).toContain("AND chain.source_id <> 'il-fixture' THEN chain.source_id");
    expect(sql).toContain("ELSE EXCLUDED.source_id");
  });
});
