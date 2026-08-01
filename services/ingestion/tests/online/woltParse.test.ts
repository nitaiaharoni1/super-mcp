import { describe, expect, it } from "vitest";
import {
  WOLT_CHAIN_ID,
  normalizeWoltGtin,
  parseCategoryPage,
  parseUnitInfo,
  parseVenuePage,
} from "../../src/online/sources/wolt/parse.js";

const META = { name: "וולט מרקט | בן יהודה", city: "תל אביב-יפו", address: null, lat: 32.08, lng: 34.77 };

describe("Wolt barcodes join to the regulated feeds", () => {
  it("strips the GTIN-14 padding so the same product is one product", () => {
    // Wolt pads to 14 digits, the feeds publish EAN-13. Left padded, the same
    // physical item becomes two products and the cross-chain comparison that the
    // whole barcode join exists for silently stops working.
    expect(normalizeWoltGtin("07290101503606")).toBe("7290101503606");
    expect(normalizeWoltGtin("7290101503606")).toBe("7290101503606");
  });

  it("refuses anything too short to be a barcode", () => {
    expect(normalizeWoltGtin("1234")).toBeNull();
    expect(normalizeWoltGtin("")).toBeNull();
    expect(normalizeWoltGtin(null)).toBeNull();
  });

  it("keeps a code that is all zeros rather than trimming it to nothing", () => {
    expect(normalizeWoltGtin("00000000")).toBe("00000000");
  });
});

describe("Wolt pack sizes", () => {
  it("reads the Hebrew abbreviations Wolt actually writes", () => {
    expect(parseUnitInfo("900 ג׳")).toEqual({ qty: 900, unit: "ג׳" });
    expect(parseUnitInfo("1.5 ליטר")).toEqual({ qty: 1.5, unit: "ליטר" });
  });

  it("returns nothing rather than a guess when there is no size", () => {
    expect(parseUnitInfo("")).toBeNull();
    expect(parseUnitInfo(undefined)).toBeNull();
    expect(parseUnitInfo("מארז")).toBeNull();
  });
});

describe("parsing a venue", () => {
  const html = `<html><script>{"slug":"wolt-market-ben-yehuda","delivery_base_price":1000,
    "service_fee_estimate":{"min":100,"max":590,"percentage":5},
    "delivery_methods":["homedelivery","takeaway"],
    "show_zero_markup":false,
    "info":{"venue_info_order_minimum":"₪70.00"}}</script></html>`;

  it("files the venue as an online endpoint using the feed's own code", () => {
    // storeType 2 is what the regulated Stores file uses for an online endpoint,
    // so classifyStoreKind treats a Wolt venue exactly like a filed storefront
    // instead of guessing from its name.
    const [store] = [...parseVenuePage(html, "wolt-market-ben-yehuda", META)];
    expect(store).toMatchObject({
      kind: "store",
      chainId: WOLT_CHAIN_ID,
      storeId: "wolt-market-ben-yehuda",
      storeType: 2,
    });
  });

  it("carries the delivery terms Wolt publishes alongside its prices", () => {
    const [store] = [...parseVenuePage(html, "wolt-market-ben-yehuda", META)];
    const raw = (store as { raw: Record<string, unknown> }).raw;
    expect(raw["deliveryBasePrice"]).toBe(10);
    expect(raw["orderMinimum"]).toBe("₪70.00");
  });

  it("still yields a store when the venue payload is unrecognisable", () => {
    // A shape change must degrade to "no terms", never to "no store": the prices
    // are parsed separately and would otherwise be orphaned.
    const [store] = [...parseVenuePage("<html>nothing</html>", "x", META)];
    expect(store).toMatchObject({ kind: "store", storeId: "x" });
  });
});

describe("parsing a category page", () => {
  const item = (gtin: string, name: string, price: number) =>
    `{"name":"${name}","barcode_gtin":"${gtin}","price":${price},"unit_info":"900 ג׳"}`;
  const html = `<html><script>[${item("07290101503606", "בצל יבש", 790)},${item(
    "07290101503682",
    "פלפל אדום",
    1090,
  )}]</script></html>`;

  it("converts agorot to shekels", () => {
    const rows = [...parseCategoryPage(html, "venue-1")];
    expect(rows[0]).toMatchObject({ kind: "price", price: 7.9, itemType: 1 });
    expect(rows[1]).toMatchObject({ price: 10.9 });
  });

  it("marks the code as a real barcode so it joins across chains", () => {
    const rows = [...parseCategoryPage(html, "venue-1")];
    expect(rows[0]).toMatchObject({ itemCode: "7290101503606", itemType: 1 });
  });

  it("does not emit the same product twice from one page", () => {
    const dup = `<html><script>[${item("07290101503606", "בצל", 790)},${item("07290101503606", "בצל", 800)}]</script></html>`;
    expect([...parseCategoryPage(dup, "venue-1")]).toHaveLength(1);
  });

  it("skips a row with no usable price rather than writing a zero", () => {
    const zero = `<html><script>[${item("07290101503606", "בצל", 0)}]</script></html>`;
    expect([...parseCategoryPage(zero, "venue-1")]).toHaveLength(0);
  });

  it("yields nothing when the page shape changes, instead of nonsense", () => {
    expect([...parseCategoryPage("<html>no json here</html>", "venue-1")]).toHaveLength(0);
  });
});
