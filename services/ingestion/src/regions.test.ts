import { describe, expect, it } from "vitest";
import { isStoreInIngestRegion, normalizeCityKey } from "./regions.js";
import { selectRegionalFeedFiles } from "./selectRegionalFiles.js";
import type { FeedFile } from "@super-mcp/shared";

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
    expect(isStoreInIngestRegion({ storeId: "1", lat: 32.08, lng: 34.78 })).toBe(true); // TLV
    expect(isStoreInIngestRegion({ storeId: "2", lat: 31.25, lng: 34.80 })).toBe(true); // Beer Sheva
    expect(isStoreInIngestRegion({ storeId: "3", lat: 29.55, lng: 34.95 })).toBe(false); // Eilat-ish
  });

  it("normalizes city keys", () => {
    expect(normalizeCityKey("  תל אביב  ")).toBe(normalizeCityKey("תל אביב"));
  });

  it("does not treat 'אזור תעשייה' (industrial zone) as the town Azor", () => {
    // Store in Eilat whose NAME contains the word אזור:
    expect(
      isStoreInIngestRegion({ storeId: "1", city: "אילת", name: "רמי לוי אזור תעשייה" }),
    ).toBe(false);
    // City field that merely starts with אזור:
    expect(isStoreInIngestRegion({ storeId: "2", city: "אזור תעשייה ספיר" })).toBe(false);
    // The actual town of Azor (exact city match) stays covered:
    expect(isStoreInIngestRegion({ storeId: "3", city: "אזור" })).toBe(true);
  });

  it("matches city names inside store names only on word boundaries", () => {
    expect(isStoreInIngestRegion({ storeId: "1", name: "שופרסל דיל נתניה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", name: "שופרסל-נתניה" })).toBe(true);
    // "יהודה" contains "יהוד" as a substring but is not the city Yehud:
    expect(isStoreInIngestRegion({ storeId: "3", name: "מרכז יהודה הלוי" })).toBe(false);
  });

  it("matches the city field prefix only on whole-word boundaries", () => {
    // "יהודה" (Yehuda) is not the covered town "יהוד" (Yehud) — same substring
    // hazard as the name-hint path, but through the city field's prefix match.
    expect(isStoreInIngestRegion({ storeId: "1", city: "יהודה" })).toBe(false);
    // A real suffixed variant of a covered city keeps matching by whole words.
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
    const prev = process.env.SUPER_MCP_REGION_FILTER;
    process.env.SUPER_MCP_REGION_FILTER = "1";
    try {
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
    } finally {
      if (prev === undefined) delete process.env.SUPER_MCP_REGION_FILTER;
      else process.env.SUPER_MCP_REGION_FILTER = prev;
    }
  });
});
