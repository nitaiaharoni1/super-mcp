import { describe, expect, it } from "vitest";
import {
  CITY_CENTROID,
  centroidForCity,
} from "../../src/utils/cityCentroids.js";
import { ISRAEL_STORE_COORDINATE_BOUNDS } from "../../src/utils/storeCoordinates.js";

describe("centroidForCity", () => {
  it("resolves a canonical Hebrew city name to its centroid", () => {
    expect(centroidForCity("הרצליה")).toEqual({ lat: 32.1656, lng: 34.8469 });
  });

  it("resolves a CBS locality code to the same centroid as its Hebrew name", () => {
    // 6400 = הרצליה; both must land on the same point.
    expect(centroidForCity("6400")).toEqual(centroidForCity("הרצליה"));
    // 5000 = תל אביב-יפו
    expect(centroidForCity("5000")).toEqual(centroidForCity("תל אביב-יפו"));
  });

  it("resolves an unmapped-in-base CBS code added for geocoding (70 = אשדוד)", () => {
    expect(centroidForCity("70")).toEqual(centroidForCity("אשדוד"));
    expect(centroidForCity("70")).not.toBeNull();
  });

  it("resolves an English/alias spelling via canonicalization", () => {
    expect(centroidForCity("Herzliya")).toEqual(centroidForCity("הרצליה"));
  });

  it("returns null for the unmappable literal '0' city", () => {
    expect(centroidForCity("0")).toBeNull();
  });

  it("returns null for null/empty/unknown cities", () => {
    expect(centroidForCity(null)).toBeNull();
    expect(centroidForCity(undefined)).toBeNull();
    expect(centroidForCity("")).toBeNull();
    expect(centroidForCity("NoSuchTown123")).toBeNull();
  });

  it("keeps every mapped centroid inside the supported Israel bounds", () => {
    const b = ISRAEL_STORE_COORDINATE_BOUNDS;
    for (const [city, { lat, lng }] of Object.entries(CITY_CENTROID)) {
      expect(lat, `${city} lat`).toBeGreaterThanOrEqual(b.minLat);
      expect(lat, `${city} lat`).toBeLessThanOrEqual(b.maxLat);
      expect(lng, `${city} lng`).toBeGreaterThanOrEqual(b.minLng);
      expect(lng, `${city} lng`).toBeLessThanOrEqual(b.maxLng);
      // Every centroid must survive the normalize guard used at write time.
      expect(centroidForCity(city), `${city} normalizes`).toEqual({ lat, lng });
    }
  });
});
