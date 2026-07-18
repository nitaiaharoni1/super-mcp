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
