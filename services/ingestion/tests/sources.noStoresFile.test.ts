/**
 * A chain that publishes price files but no Stores file.
 *
 * The region filter builds its allow-list from the feed's Stores file. Fresh
 * Market publishes 51 PriceFull and 51 PromoFull files and zero Stores files, so
 * the allow-list came back empty and selectRegionalFeedFiles dropped every price
 * file. Not a transient failure: the chain was uningestable permanently, while
 * having 45 branches in the database the whole time, including Tel Aviv,
 * Herzliya, Petah Tikva and Haifa.
 *
 * Verified against production after the fix: 0 fresh stores became 38 of 45.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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
});
