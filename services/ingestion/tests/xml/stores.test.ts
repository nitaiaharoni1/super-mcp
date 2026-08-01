import { describe, expect, it } from "vitest";
import { parseStoresXml } from "../../src/xml/stores.js";

function storesXml(latitude: string, longitude: string): string {
  return `<Root><Stores><Store>
    <StoreId>17</StoreId>
    <StoreName>Herzliya Test</StoreName>
    <City>הרצליה</City>
    <Latitude>${latitude}</Latitude>
    <Longitude>${longitude}</Longitude>
  </Store></Stores></Root>`;
}

describe("parseStoresXml coordinate integrity", () => {
  it.each([
    ["0", "0"],
    ["32.16", "0"],
    ["0", "34.84"],
    ["95", "34.84"],
    ["40.71", "-74.01"],
  ])("omits invalid coordinates (%s, %s)", (lat, lng) => {
    expect(parseStoresXml(storesXml(lat, lng), "chain-1")[0]?.geo).toBeUndefined();
  });

  it("keeps valid Israel coordinates", () => {
    expect(parseStoresXml(storesXml("32.16", "34.84"), "chain-1")[0]?.geo).toEqual({
      lat: 32.16,
      lng: 34.84,
    });
  });
});

describe("parseStoresXml <StoreType>", () => {
  /** Shufersal's own file, byte for byte apart from the wrapper. */
  const shufersal = `<Chain><ChainID>7290027600007</ChainID><SubChains><SubChain>
    <SubChainID>2</SubChainID><Stores>
      <Store><StoreID>413</StoreID><StoreType>2</StoreType>
        <StoreName>שופרסל ONLINE</StoreName><Address>WWW.SHUFERSAL.CO.IL</Address></Store>
      <Store><StoreID>374</StoreID><StoreType>1</StoreType>
        <StoreName>שלי הרצליה- הבנים</StoreName><Address>הבנים 46</Address></Store>
    </Stores></SubChain></SubChains></Chain>`;

  it("reads the chain's declared endpoint type", () => {
    const stores = parseStoresXml(shufersal, "7290027600007");
    expect(stores.map((s) => [s.storeId, s.storeType])).toEqual([
      ["413", 2],
      ["374", 1],
    ]);
  });

  it("leaves it undefined when the chain omits the element", () => {
    expect(parseStoresXml(storesXml("32.16", "34.84"), "chain-1")[0]?.storeType).toBeUndefined();
  });
});

describe("parseStoresXml <Store><Branches> filings", () => {
  // H. Cohen files this shape on laibcatalog: the document root is a single
  // <Store> element whose children are <Branch>, not the <Root><SubChains>
  // layout every other chain uses. Read as the usual shape it yields one entry
  // with no StoreID and therefore no stores at all, which the region filter
  // then reports as "no stores matched coverage" — the chain silently ingests
  // nothing rather than failing.
  const branches = `<?xml version="1.0" encoding="utf-8"?>
    <Store Date="01/08/26" Time="06:27:03"><Branches>
      <Branch>
        <ChainID>7290455000004</ChainID><SubChainID>001</SubChainID>
        <StoreID>001</StoreID><StoreType>1</StoreType>
        <StoreName>המלאכה</StoreName><City>נתיבות</City>
      </Branch>
      <Branch>
        <ChainID>7290455000004</ChainID><SubChainID>001</SubChainID>
        <StoreID>065</StoreID><StoreType>1</StoreType>
        <StoreName>מול שדרות</StoreName><City>שדרות</City>
      </Branch>
    </Branches></Store>`;

  it("reads every branch as a store", () => {
    const stores = parseStoresXml(branches, "7290455000004");
    expect(stores.map((s) => [s.storeId, s.name, s.city])).toEqual([
      ["001", "המלאכה", "נתיבות"],
      ["065", "מול שדרות", "שדרות"],
    ]);
  });

  it("still carries the chain id and declared endpoint type", () => {
    const stores = parseStoresXml(branches, "7290455000004");
    expect(stores[0]).toMatchObject({ chainId: "7290455000004", storeType: 1 });
  });

  it("leaves the <Root><SubChains> shape untouched", () => {
    // Victory's own filing on the same portal uses the standard layout, so the
    // Branches branch must not take over when a real <Stores> list is present.
    const victory = `<Root><ChainID>7290696200003</ChainID><SubChains><SubChain>
      <SubChainId>001</SubChainId><Stores>
        <Store><StoreID>001</StoreID><StoreType>1</StoreType>
          <StoreName>גן-יבנה</StoreName><City>גן יבנה</City></Store>
        <Store><StoreID>097</StoreID><StoreType>2</StoreType>
          <StoreName>אינטרנט</StoreName><Address>victoryonline.co.il</Address></Store>
      </Stores></SubChain></SubChains></Root>`;
    expect(parseStoresXml(victory, "7290696200003").map((s) => [s.storeId, s.storeType])).toEqual([
      ["001", 1],
      ["097", 2],
    ]);
  });
});
