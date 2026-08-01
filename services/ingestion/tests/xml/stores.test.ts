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
