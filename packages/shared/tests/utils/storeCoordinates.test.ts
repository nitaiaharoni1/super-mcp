import { describe, expect, it } from "vitest";
import { normalizeStoreCoordinates } from "../../src/utils/storeCoordinates.js";

describe("normalizeStoreCoordinates", () => {
  it.each([
    [0, 0],
    [32.16, 0],
    [0, 34.84],
    [91, 34.84],
    [32.16, 181],
    [40.71, -74.01],
  ])("rejects invalid or non-Israel coordinates (%s, %s)", (lat, lng) => {
    expect(normalizeStoreCoordinates(lat, lng)).toBeNull();
  });

  it("accepts coordinates within the supported Israel region", () => {
    expect(normalizeStoreCoordinates(32.16, 34.84)).toEqual({ lat: 32.16, lng: 34.84 });
  });
});
