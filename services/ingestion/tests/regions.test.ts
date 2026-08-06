import { describe, expect, it } from "vitest";
import { isOrderableStorefront, isStoreInIngestRegion, normalizeCityKey } from "../src/regions.js";
import { selectRegionalFeedFiles } from "../src/selectRegionalFiles.js";
import type { FeedFile } from "@super-mcp/shared";

/** Restores whatever the ambient env was, so one test cannot leak into the next. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("isStoreInIngestRegion", () => {
  it("allows Gush Dan / Sharon cities", () => {
    expect(isStoreInIngestRegion({ storeId: "1", city: "תל אביב" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", city: "ראשון לציון" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "3", city: "נתניה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "4", city: "הרצליה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "5", city: "פתח תקווה" })).toBe(true);
  });

  it("allows Jerusalem, Haifa, Beersheva", () => {
    expect(isStoreInIngestRegion({ storeId: "1", city: "ירושלים" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", city: "חיפה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "3", city: "באר שבע" })).toBe(true);
  });

  it("rejects cities outside coverage", () => {
    expect(isStoreInIngestRegion({ storeId: "1", city: "אילת" })).toBe(false);
    expect(isStoreInIngestRegion({ storeId: "2", city: "טבריה" })).toBe(false);
    expect(isStoreInIngestRegion({ storeId: "3", city: "צפת" })).toBe(false);
  });

  it("allows by lat/lng box when city missing", () => {
    expect(isStoreInIngestRegion({ storeId: "1", lat: 32.08, lng: 34.78 })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", lat: 31.25, lng: 34.80 })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "3", lat: 29.55, lng: 34.95 })).toBe(false);
  });

  it("allows CBS locality codes used in Stores XML City fields", () => {
    expect(isStoreInIngestRegion({ storeId: "1", city: "5000" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", city: "3000" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "3", city: "4000" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "4", city: "9000" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "5", city: "8300" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "6", city: "2600" })).toBe(false);
    expect(isStoreInIngestRegion({ storeId: "7", city: "7100" })).toBe(false);
  });

  it("normalizes city keys", () => {
    expect(normalizeCityKey("  תל אביב  ")).toBe(normalizeCityKey("תל אביב"));
  });

  it("does not treat 'אזור תעשייה' (industrial zone) as the town Azor", () => {
    expect(
      isStoreInIngestRegion({ storeId: "1", city: "אילת", name: "רמי לוי אזור תעשייה" }),
    ).toBe(false);
    expect(isStoreInIngestRegion({ storeId: "2", city: "אזור תעשייה ספיר" })).toBe(false);
    expect(isStoreInIngestRegion({ storeId: "3", city: "אזור" })).toBe(true);
  });

  it("matches city names inside store names only on word boundaries", () => {
    expect(isStoreInIngestRegion({ storeId: "1", name: "שופרסל דיל נתניה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", name: "שופרסל-נתניה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "3", name: "מרכז יהודה הלוי" })).toBe(false);
  });

  it("matches the city field prefix only on whole-word boundaries", () => {
    expect(isStoreInIngestRegion({ storeId: "1", city: "יהודה" })).toBe(false);
    expect(isStoreInIngestRegion({ storeId: "2", city: "תל אביב יפו - מרכז" })).toBe(true);
  });
});

describe("selectRegionalFeedFiles", () => {
  const files: FeedFile[] = [
    {
      sourceId: "t",
      kind: "stores",
      remotePath: "Stores.xml",
      fileName: "Stores.xml",
      chainId: "1",
    },
    {
      sourceId: "t",
      kind: "pricesfull",
      remotePath: "p-tlv",
      fileName: "PriceFull-001.xml",
      chainId: "1",
      storeId: "001",
    },
    {
      sourceId: "t",
      kind: "pricesfull",
      remotePath: "p-eilat",
      fileName: "PriceFull-099.xml",
      chainId: "1",
      storeId: "099",
    },
    {
      sourceId: "t",
      kind: "promosfull",
      remotePath: "promo-tlv",
      fileName: "PromoFull-001.xml",
      chainId: "1",
      storeId: "001",
    },
  ];

  it("keeps only in-region store price files and always keeps Stores", () => {
    withEnv({ SUPER_MCP_REGION_FILTER: "1", SUPER_MCP_ONLINE_STORES_ONLY: "0" }, () => {
      const selected = selectRegionalFeedFiles(
        files,
        [
          { storeId: "001", city: "תל אביב" },
          { storeId: "099", city: "אילת" },
        ],
        10,
      );
      expect(selected.some((f) => f.kind === "stores")).toBe(true);
      expect(selected.filter((f) => f.kind === "pricesfull")).toHaveLength(1);
      expect(selected.find((f) => f.kind === "pricesfull")?.storeId).toBe("001");
      expect(selected.filter((f) => f.kind === "promosfull")).toHaveLength(1);
    });
  });

  // The default. 97.7% of every price row production held belonged to a branch
  // no tool on the live surface can route an order to, and downloading them was
  // what pushed the nightly job past the database's capacity.
  it("keeps only the storefront's files, whatever region the branches are in", () => {
    withEnv({ SUPER_MCP_ONLINE_STORES_ONLY: undefined }, () => {
      const selected = selectRegionalFeedFiles(
        files,
        [
          // A Tel Aviv branch: in region, and still not somewhere you can order from.
          { storeId: "001", city: "תל אביב" },
          { storeId: "099", city: "אילת", name: "אונליין", storeType: 2 },
        ],
        10,
      );
      expect(selected.filter((f) => f.kind === "pricesfull").map((f) => f.storeId)).toEqual(["099"]);
      // Promo files follow the same store set, or a storefront's discounts would
      // be quoted against another store's prices.
      expect(selected.filter((f) => f.kind === "promosfull")).toHaveLength(0);
    });
  });

  // Eight of the sixteen chains we hold genuinely have no storefront. Zero price
  // files is the correct answer for them, and it must not be an error.
  it("still keeps the Stores file for a chain with no storefront at all", () => {
    withEnv({ SUPER_MCP_ONLINE_STORES_ONLY: undefined }, () => {
      const selected = selectRegionalFeedFiles(files, [{ storeId: "001", city: "תל אביב" }], 10);
      expect(selected.map((f) => f.kind)).toEqual(["stores"]);
    });
  });
});

describe("isOrderableStorefront", () => {
  it("takes the chain's own StoreType over what the name reads like", () => {
    // Rami Levy 039. Reads as a distribution centre, IS the chain's online store,
    // and is the entire Rami Levy delivery catalogue.
    expect(
      isOrderableStorefront({ storeId: "039", name: "מרלוג אינטרנט", storeType: 2 }),
    ).toBe(true);
    // The same row with the field missing classifies as a warehouse, which is why
    // the database backstop exists.
    expect(isOrderableStorefront({ storeId: "039", name: "מרלוג אינטרנט" })).toBe(false);
  });

  it("recognises a storefront from its name when the feed files no type", () => {
    // Tiv Taam's picking stores: two of the seven carry no StoreType.
    expect(isOrderableStorefront({ storeId: "1", name: "ליקוט רמת החייל" })).toBe(true);
    expect(isOrderableStorefront({ storeId: "2", name: "שופרסל ONLINE" })).toBe(true);
  });

  it("counts click-and-collect, which the delivery surface quotes", () => {
    // Yohananof files these as StoreType 1, and they are still not walk-in shops.
    expect(isOrderableStorefront({ storeId: "3", name: "גדרה פיק אפ", storeType: 1 })).toBe(true);
  });

  it("rejects an ordinary branch", () => {
    expect(isOrderableStorefront({ storeId: "4", name: "שופרסל דיל רמת גן", storeType: 1 })).toBe(
      false,
    );
    expect(isOrderableStorefront({ storeId: "5", city: "תל אביב" })).toBe(false);
  });

  it("trusts a kind already decided over re-deriving one from the name", () => {
    expect(
      isOrderableStorefront({ storeId: "039", name: "מרלוג אינטרנט", storeKind: "online" }),
    ).toBe(true);
  });
});
