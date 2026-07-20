import { describe, expect, it, vi } from "vitest";
import {
  applyLocationOriginHonesty,
  resolveLocationInput,
} from "../../src/lib/locationInput.js";
import type { StoreLocationMetadata } from "../../src/lib/resolveStoreLocation.js";
import { AppError } from "@super-mcp/shared";

function baseLocation(overrides: Partial<StoreLocationMetadata> = {}): StoreLocationMetadata {
  return {
    scope: "near",
    precision: "radius",
    fallbackApplied: false,
    warning: null,
    distanceReliable: true,
    requested: {
      city: null,
      near: { lat: 32.17, lng: 34.84 },
      radiusKm: 10,
    },
    ...overrides,
  };
}

describe("resolveLocationInput", () => {
  it("parses near without calling the geocoder", async () => {
    const resolveGeocode = vi.fn();
    const result = await resolveLocationInput(
      { near: "32.1656,34.8469", radiusKm: 5 },
      { resolveGeocode },
    );
    expect(resolveGeocode).not.toHaveBeenCalled();
    expect(result.near).toEqual({ lat: 32.1656, lng: 34.8469 });
    expect(result.radiusKm).toBe(5);
    expect(result.locationOrigin?.precision).toBe("coordinates");
  });

  it("rejects near + location", async () => {
    await expect(
      resolveLocationInput({ near: "32.16,34.84", location: "נווה עמל" }),
    ).rejects.toMatchObject({ code: "bad_request", statusCode: 400 });
  });

  it("geocodes location and defaults radius to 10km", async () => {
    const resolveGeocode = vi.fn().mockResolvedValue({
      status: "ok",
      point: { lat: 32.17, lng: 34.84 },
      precision: "neighborhood",
      provider: "nominatim",
      cached: false,
      fallbackApplied: false,
      displayName: "Neve Amal, Herzliya",
      attribution: "© OpenStreetMap contributors",
      warning: null,
    });
    const result = await resolveLocationInput(
      { location: "נווה עמל", city: "הרצליה" },
      { resolveGeocode },
    );
    expect(resolveGeocode).toHaveBeenCalledWith({
      location: "נווה עמל",
      city: "הרצליה",
    });
    expect(result.city).toBe("הרצליה");
    expect(result.near).toEqual({ lat: 32.17, lng: 34.84 });
    expect(result.radiusKm).toBe(10);
    expect(result.locationOrigin).toMatchObject({
      precision: "neighborhood",
      provider: "nominatim",
      attribution: "© OpenStreetMap contributors",
    });
  });

  it("maps not_found → 400 and unavailable → 503", async () => {
    await expect(
      resolveLocationInput(
        { location: "nowhere" },
        {
          resolveGeocode: async () => ({
            status: "not_found",
            point: null,
            precision: null,
            provider: null,
            cached: false,
            fallbackApplied: false,
            displayName: null,
            attribution: null,
            warning: "location not found",
          }),
        },
      ),
    ).rejects.toBeInstanceOf(AppError);

    try {
      await resolveLocationInput(
        { location: "nowhere" },
        {
          resolveGeocode: async () => ({
            status: "unavailable",
            point: null,
            precision: null,
            provider: null,
            cached: false,
            fallbackApplied: false,
            displayName: null,
            attribution: null,
            warning: "timeout",
          }),
        },
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "geocoding_unavailable", statusCode: 503 });
    }
  });

  it("passes city-only through without a point", async () => {
    const result = await resolveLocationInput({ city: "הרצליה" });
    expect(result).toEqual({
      city: "הרצליה",
      near: undefined,
      radiusKm: undefined,
      locationOrigin: undefined,
    });
  });
});

describe("applyLocationOriginHonesty", () => {
  it("suppresses distance ranking for city-precision origins", () => {
    const merged = applyLocationOriginHonesty(baseLocation(), {
      precision: "city",
      provider: "city_centroid",
      cached: false,
      fallbackApplied: true,
      displayName: "הרצליה",
      attribution: null,
      warning: "using city centroid",
    });
    expect(merged.distanceReliable).toBe(false);
    expect(merged.precision).toBe("city");
    expect(merged.fallbackApplied).toBe(true);
    expect(merged.warning).toMatch(/centroid/i);
    expect(merged.origin?.provider).toBe("city_centroid");
  });

  it("keeps distanceReliable for neighborhood origins when stores are reliable", () => {
    const merged = applyLocationOriginHonesty(baseLocation({ distanceReliable: true }), {
      precision: "neighborhood",
      provider: "nominatim",
      cached: true,
      fallbackApplied: false,
      displayName: "Neve Amal",
      attribution: "© OpenStreetMap contributors",
      warning: null,
    });
    expect(merged.distanceReliable).toBe(true);
    expect(merged.origin?.precision).toBe("neighborhood");
  });
});
