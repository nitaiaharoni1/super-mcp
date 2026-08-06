/**
 * A chain that publishes price files but no Stores file.
 *
 * The discovery filter builds its allow-list from the feed's Stores file. Fresh
 * Market publishes 51 PriceFull and 51 PromoFull files and zero Stores files, so
 * the allow-list came back empty and selectRegionalFeedFiles dropped every price
 * file. Not a transient failure: the chain was uningestable permanently, while
 * having 45 branches in the database the whole time, including Tel Aviv,
 * Herzliya, Petah Tikva and Haifa.
 *
 * Verified against production after the fix: 0 fresh stores became 38 of 45.
 *
 * The branch half of this now runs with SUPER_MCP_ONLINE_STORES_ONLY=0, because
 * under the default a chain with no storefront correctly ingests no prices. The
 * fallback still matters there: it is what carries the store KIND when the feed
 * cannot, and the last two cases pin that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const knownLocations = vi.fn();

vi.mock("basic-ftp", () => ({
  Client: class {
    ftp = { verbose: false };
    access = vi.fn();
    close = vi.fn();
    list = (...a: unknown[]) => listMock(...a);
    downloadTo = vi.fn();
  },
}));
vi.mock("@super-mcp/db", () => ({
  knownStoreLocationsForChain: (...a: unknown[]) => knownLocations(...a),
}));

const FRESH_MARKET = "7290876100000";

beforeEach(() => {
  vi.resetModules();
  process.env.SUPER_MCP_NO_CAP = "1";
  process.env.SUPER_MCP_ONLINE_STORES_ONLY = "0";
  // Two Tel Aviv branches: inside the ingest coverage region.
  knownLocations.mockReset().mockResolvedValue([
    { storeId: "001", city: "תל אביב-יפו", lat: 32.0853, lng: 34.7818 },
    { storeId: "002", city: "תל אביב-יפו", lat: 32.08, lng: 34.78 },
  ]);
  listMock.mockReset().mockResolvedValue([
    // Deliberately no Stores file, matching what this chain actually publishes.
    { name: `PriceFull${FRESH_MARKET}-001-001-20260726-001002.gz`, isFile: true, type: 1, size: 10 },
    { name: `PriceFull${FRESH_MARKET}-001-002-20260726-001008.gz`, isFile: true, type: 1, size: 10 },
  ]);
});

afterEach(() => {
  delete process.env.SUPER_MCP_ONLINE_STORES_ONLY;
});

describe("chain with no Stores file", () => {
  it("falls back to branches already in the database and keeps its price files", async () => {
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    const files = await createCerberusAdapter(fm).discover();

    expect(knownLocations).toHaveBeenCalledWith(FRESH_MARKET);
    // Without the fallback this was 0, permanently.
    expect(files.filter((f) => f.kind === "pricesfull")).toHaveLength(2);
  });

  it("fails loudly when no location is available from any source", async () => {
    // With no location from the feed and none in the database there is nothing to
    // region-check against, and guessing would ingest stores outside the coverage
    // area. Discovery throws rather than returning an empty list, which is the
    // point: silently ingesting nothing is the exact failure being fixed here.
    knownLocations.mockResolvedValue([]);
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    await expect(createCerberusAdapter(fm).discover()).rejects.toThrow(/discovered 0 files/);
  });

  it("surfaces a fallback failure in the error rather than hiding it", async () => {
    knownLocations.mockRejectedValue(new Error("db down"));
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    // The reason has to reach the message, or the next person sees "0 files" with
    // no hint that the database lookup is what broke.
    await expect(createCerberusAdapter(fm).discover()).rejects.toThrow(/store-location fallback/);
  });
  it("logs the outcome even when the database has no branches either", async () => {
    // Silence must mean "did not apply", never "no idea what happened". A run
    // where this looked like it never fired cost real diagnosis time.
    knownLocations.mockResolvedValue([]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    await createCerberusAdapter(fm).discover().catch(() => undefined);

    const line = spy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("ingestion_store_locations_from_db"));
    expect(line, "fallback outcome was not logged").toBeDefined();
    expect(JSON.parse(line!).outcome).toBe("database_had_none");
    spy.mockRestore();
  });

  it("logs a WARNING when the lookup itself fails", async () => {
    knownLocations.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    await createCerberusAdapter(fm).discover().catch(() => undefined);

    const line = spy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("ingestion_store_locations_from_db"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!);
    expect(parsed.severity).toBe("WARNING");
    expect(parsed.outcome).toBe("lookup_failed");
    spy.mockRestore();
  });

  it("ingests nothing but the Stores lookup when the chain has no storefront", async () => {
    // The default. Fresh Market has 45 branches and no delivery, so the correct
    // number of price files is zero — and it must not read as a failure of the
    // fallback, which is the trap: "0 files" looked identical to the bug above.
    delete process.env.SUPER_MCP_ONLINE_STORES_ONLY;
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    await expect(createCerberusAdapter(fm).discover()).rejects.toThrow(/discovered 0 files/);
  });

  it("keeps a storefront the database knows about when the feed files no type", async () => {
    // The Rami Levy shape: the store row says online, today's feed says nothing.
    // Without the backstop this chain's whole delivery catalogue disappears for
    // the night, silently.
    delete process.env.SUPER_MCP_ONLINE_STORES_ONLY;
    knownLocations.mockResolvedValue([
      { storeId: "001", city: "תל אביב-יפו", lat: 32.0853, lng: 34.7818, storeKind: "branch" },
      { storeId: "002", city: "בני ברק", name: "מרלוג אינטרנט", storeKind: "online" },
    ]);
    const { createCerberusAdapter, CERBERUS_CHAINS } = await import(
      "../src/sources/cerberus/adapter.js"
    );
    const fm = CERBERUS_CHAINS.filter((c) => c.chainId === FRESH_MARKET);
    const files = await createCerberusAdapter(fm).discover();

    expect(files.filter((f) => f.kind === "pricesfull").map((f) => f.storeId)).toEqual(["002"]);
  });
});
