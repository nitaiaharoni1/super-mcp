import { describe, expect, it } from "vitest";
import { buildProductLink } from "../../../src/services/productLinks/buildLink.js";

const RAMI_LEVY = "7290058140886";
const YOHANANOF = "7290803800003";
const SHUFERSAL = "7290027600007";
const CARREFOUR = "7290055700007";
const OSHER_AD = "7290103152017";
const STOP_MARKET = "7290639000004";
const UNKNOWN = "0000000000000";

describe("buildProductLink", () => {
  it("prefers barcode search where the storefront indexes barcodes", () => {
    const link = buildProductLink({ chainId: RAMI_LEVY, gtin: "7290004131074", name: "חלב תנובה" });
    expect(link.via).toBe("barcode");
    expect(link.url).toBe("https://www.rami-levy.co.il/he/online/search?item=7290004131074");
  });

  it("builds the Yohananof barcode search url", () => {
    const link = buildProductLink({ chainId: YOHANANOF, gtin: "7290004131074", name: "חלב" });
    expect(link.via).toBe("barcode");
    expect(link.url).toBe("https://yochananof.co.il/category?search=7290004131074");
  });

  it("falls back to name search for Shufersal, which doesn't index barcodes", () => {
    const link = buildProductLink({ chainId: SHUFERSAL, gtin: "7290004131074", name: "חלב תנובה 3%" });
    expect(link.via).toBe("name");
    expect(link.url).toBe(
      `https://www.shufersal.co.il/online/he/search?text=${encodeURIComponent("חלב תנובה 3%")}`,
    );
  });

  it("uses name search when the item has no GTIN (e.g. weighed produce)", () => {
    const link = buildProductLink({ chainId: RAMI_LEVY, gtin: null, name: "עגבניות" });
    expect(link.via).toBe("name");
    expect(link.url).toBe(
      `https://www.rami-levy.co.il/he/online/search?q=${encodeURIComponent("עגבניות")}`,
    );
  });

  it("builds the shared stor.ai barcode search url", () => {
    const link = buildProductLink({ chainId: CARREFOUR, gtin: "7290004131074", name: "חלב" });
    expect(link.via).toBe("barcode");
    expect(link.url).toBe("https://www.carrefour.co.il/search/7290004131074");
  });

  it("returns no_online_store for chains without a storefront", () => {
    for (const chainId of [OSHER_AD, STOP_MARKET]) {
      const link = buildProductLink({ chainId, gtin: "7290004131074", name: "חלב" });
      expect(link.url).toBeNull();
      expect(link.reason).toBe("no_online_store");
    }
  });

  it("returns unmapped_chain for chains not in the table", () => {
    const link = buildProductLink({ chainId: UNKNOWN, gtin: "7290004131074", name: "חלב" });
    expect(link.url).toBeNull();
    expect(link.reason).toBe("unmapped_chain");
  });

  it("returns no_identifier when neither barcode nor name is usable", () => {
    const link = buildProductLink({ chainId: SHUFERSAL, gtin: null, name: "  " });
    expect(link.url).toBeNull();
    expect(link.reason).toBe("no_identifier");
  });
});
