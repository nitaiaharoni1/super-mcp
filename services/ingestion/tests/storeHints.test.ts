/**
 * The backstop that stops a feed hiccup from silently retracting a storefront.
 *
 * Zero orderable storefronts is the CORRECT answer for eight of the sixteen
 * chains we hold, so it cannot be treated as an error. That is exactly what
 * makes the failure dangerous: a chain that lost its storefront for a night is
 * indistinguishable, in the logs and in the file count, from a chain that never
 * had one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedFile } from "@super-mcp/shared";

const knownLocations = vi.fn();
vi.mock("@super-mcp/db", () => ({
  knownStoreLocationsForChain: (...a: unknown[]) => knownLocations(...a),
}));

const { selectFeedFilesForChain, chainsWithNoStorefront, _resetStorefrontlessChains } =
  await import("../src/storeHints.js");

const CHAIN = "7290058140886";

const files: FeedFile[] = [
  { sourceId: "t", kind: "stores", remotePath: "s", fileName: "Stores.xml", chainId: CHAIN },
  {
    sourceId: "t",
    kind: "pricesfull",
    remotePath: "p1",
    fileName: "PriceFull-001.xml",
    chainId: CHAIN,
    storeId: "001",
  },
  {
    sourceId: "t",
    kind: "pricesfull",
    remotePath: "p39",
    fileName: "PriceFull-039.xml",
    chainId: CHAIN,
    storeId: "039",
  },
];

/** The store row as the database holds it: classified online on a healthy day. */
const KNOWN_ONLINE = {
  storeId: "039",
  city: "בני ברק",
  lat: null,
  lng: null,
  name: "מרלוג אינטרנט",
  address: null,
  storeType: 2,
  storeKind: "online",
};

function pricedStoreIds(selected: FeedFile[]): string[] {
  return selected.filter((f) => f.kind === "pricesfull").map((f) => f.storeId!);
}

beforeEach(() => {
  delete process.env.SUPER_MCP_ONLINE_STORES_ONLY;
  _resetStorefrontlessChains();
  knownLocations.mockReset().mockResolvedValue([KNOWN_ONLINE]);
});

afterEach(() => {
  delete process.env.SUPER_MCP_ONLINE_STORES_ONLY;
});

describe("selectFeedFilesForChain", () => {
  it("restores a storefront missing from today's Stores file", async () => {
    // The feed lists only the branch. Without the backstop, Rami Levy's entire
    // delivery catalogue goes unpriced for the night.
    const selected = await selectFeedFilesForChain(
      CHAIN,
      files,
      [{ storeId: "001", city: "תל אביב" }],
      50,
    );
    expect(pricedStoreIds(selected)).toEqual(["039"]);
  });

  it("overrides a record that no longer reads as orderable", async () => {
    // Present today, but StoreType went missing, so the name alone classifies
    // "מרלוג אינטרנט" as a warehouse.
    const selected = await selectFeedFilesForChain(
      CHAIN,
      files,
      [
        { storeId: "001", city: "תל אביב" },
        { storeId: "039", name: "מרלוג אינטרנט" },
      ],
      50,
    );
    expect(pricedStoreIds(selected)).toEqual(["039"]);
  });

  it("says which stores it rescued, and how", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    const line = spy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("ingestion_orderable_backstop_applied"));
    expect(line, "a silent rescue is a rescue nobody can audit").toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ chainId: CHAIN, restoredFromDb: ["039"] });
    spy.mockRestore();
  });

  it("stays quiet when the feed already had it right", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const selected = await selectFeedFilesForChain(
      CHAIN,
      files,
      [{ storeId: "039", name: "מרלוג אינטרנט", storeType: 2 }],
      50,
    );
    expect(pricedStoreIds(selected)).toEqual(["039"]);
    expect(spy.mock.calls.map((c) => String(c[0])).join("")).not.toContain("backstop_applied");
    spy.mockRestore();
  });

  it("never resurrects a branch", async () => {
    // The backstop widens the storefront set and nothing else. A chain that
    // closes its online store should stop being priced, not be pinned open.
    knownLocations.mockResolvedValue([
      { ...KNOWN_ONLINE, storeId: "001", name: "רמי לוי גבעת שאול", storeType: 1, storeKind: "branch" },
    ]);
    const selected = await selectFeedFilesForChain(
      CHAIN,
      files,
      [{ storeId: "001", city: "ירושלים", storeType: 1 }],
      50,
    );
    expect(pricedStoreIds(selected)).toEqual([]);
  });

  it("falls through to the feed when the lookup itself fails", async () => {
    // A safety net that throws is worse than none.
    knownLocations.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const selected = await selectFeedFilesForChain(
      CHAIN,
      files,
      [{ storeId: "039", name: "מרלוג אינטרנט", storeType: 2 }],
      50,
    );
    expect(pricedStoreIds(selected)).toEqual(["039"]);
    expect(spy.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "ingestion_orderable_backstop_unavailable",
    );
    spy.mockRestore();
  });

  it("does not query the database at all when branches are being ingested", async () => {
    process.env.SUPER_MCP_ONLINE_STORES_ONLY = "0";
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    expect(knownLocations).not.toHaveBeenCalled();
  });

  // "This chain produced no price rows" is an alarm worth keeping, and under the
  // online filter it is now the correct outcome for most chains we hold.
  // Reporting them would mark a healthy nightly run degraded every night.
  it("marks a chain with nowhere to order from, so the run does not cry wolf", async () => {
    knownLocations.mockResolvedValue([]);
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    expect(chainsWithNoStorefront()).toEqual([CHAIN]);
  });

  // Yohananof, measured 2026-08-06: three pickup points, zero PriceFull files
  // for any of them. It HAS storefronts, so a storefront-shaped test passes it
  // and the run still reports degraded nightly. What matters is whether there
  // was a file to download.
  it("marks a chain whose storefronts publish no price file", async () => {
    const storesOnly = files.filter((f) => f.kind === "stores");
    await selectFeedFilesForChain(CHAIN, storesOnly, [], 50);
    expect(chainsWithNoStorefront()).toEqual([CHAIN]);
  });

  // A file we DID download and got nothing from is a real failure, and has to
  // stay reportable. This is the line between the two.
  it("does not mark a chain whose price file was selected", async () => {
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    expect(chainsWithNoStorefront()).toEqual([]);
  });

  it("clears the mark once the chain has a storefront again", async () => {
    knownLocations.mockResolvedValue([]);
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    expect(chainsWithNoStorefront()).toEqual([CHAIN]);

    knownLocations.mockResolvedValue([KNOWN_ONLINE]);
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    expect(chainsWithNoStorefront()).toEqual([]);
  });

  it("marks nothing while branches are being ingested", async () => {
    process.env.SUPER_MCP_ONLINE_STORES_ONLY = "0";
    await selectFeedFilesForChain(CHAIN, files, [{ storeId: "001", city: "תל אביב" }], 50);
    expect(chainsWithNoStorefront()).toEqual([]);
  });
});
