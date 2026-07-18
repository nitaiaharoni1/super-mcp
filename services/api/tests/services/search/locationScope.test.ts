import { describe, expect, it } from "vitest";
import { toSearchLocationParams } from "../../../src/services/search/locationScope.js";

describe("toSearchLocationParams", () => {
  it("keeps only storeIds when storeIds are present", () => {
    expect(
      toSearchLocationParams({
        city: "SomeCity",
        near: { lat: 32.1, lng: 34.8 },
        radiusKm: 5,
        storeIds: ["11111111-1111-4111-8111-111111111111"],
      }),
    ).toEqual({
      storeIds: ["11111111-1111-4111-8111-111111111111"],
    });
  });

  it("preserves city/near when storeIds are empty or absent", () => {
    expect(
      toSearchLocationParams({
        city: "SomeCity",
        near: { lat: 32.1, lng: 34.8 },
        radiusKm: 5,
        storeIds: [],
      }),
    ).toEqual({
      city: "SomeCity",
      near: { lat: 32.1, lng: 34.8 },
      radiusKm: 5,
    });

    expect(
      toSearchLocationParams({
        city: "SomeCity",
      }),
    ).toEqual({ city: "SomeCity" });
  });
});
