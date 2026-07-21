import { describe, expect, it, vi } from "vitest";
import {
  isEligibleForDistanceRecommendation,
  resolveStoreLocation,
  type StoreLocationMetadata,
} from "../../src/lib/resolveStoreLocation.js";
import type { StoreSummary } from "../../src/services/stores/listStores.js";

function store(overrides: Partial<StoreSummary> = {}): StoreSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    chainId: "chain-1",
    chainName: "Chain",
    storeCode: "17",
    name: "Herzliya",
    address: null,
    city: "Herzliya",
    zip: null,
    lat: null,
    lng: null,
    geoSource: null,
    distanceKm: null,
    ...overrides,
  };
}

describe("resolveStoreLocation", () => {
  it("falls back to city scope when city stores have no valid coordinates", async () => {
    const loadStores = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([store({ lat: 0, lng: 0 }), store()]);

    const result = await resolveStoreLocation(
      { city: "Herzliya", near: { lat: 32.16, lng: 34.84 }, radiusKm: 5 },
      loadStores,
    );

    expect(loadStores).toHaveBeenNthCalledWith(2, { city: "Herzliya" });
    expect(result.stores).toHaveLength(2);
    expect(result.location).toMatchObject({
      scope: "city",
      precision: "city",
      fallbackApplied: true,
    });
    expect(result.location.warning).toMatch(/coordinates/i);
  });

  it("does not broaden city+near when city stores include valid geo", async () => {
    const loadStores = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([store({ lat: 32.18, lng: 34.86 })]);

    const result = await resolveStoreLocation(
      { city: "Herzliya", near: { lat: 32.16, lng: 34.84 }, radiusKm: 1 },
      loadStores,
    );

    expect(result.stores).toEqual([]);
    expect(result.location).toMatchObject({
      scope: "city_near",
      precision: "radius",
      fallbackApplied: false,
    });
  });

  it("shortens a neighborhood-suffixed city and warns when the shortened form matches", async () => {
    const loadStores = vi
      .fn()
      .mockResolvedValueOnce([]) // requested "הרצליה נווה עמל"
      .mockResolvedValueOnce([]) // shortened "הרצליה נווה"
      .mockResolvedValueOnce([store({ city: "הרצליה" })]); // shortened "הרצליה"

    const result = await resolveStoreLocation({ city: "הרצליה נווה עמל" }, loadStores);

    expect(loadStores).toHaveBeenNthCalledWith(2, { chain: undefined, city: "הרצליה נווה", storeIds: undefined });
    expect(loadStores).toHaveBeenNthCalledWith(3, { chain: undefined, city: "הרצליה", storeIds: undefined });
    expect(result.stores).toHaveLength(1);
    expect(result.location).toMatchObject({
      scope: "city",
      precision: "city",
      fallbackApplied: true,
    });
    expect(result.location.warning).toContain("הרצליה נווה עמל");
    expect(result.location.warning).toContain("הרצליה");
  });

  it("returns empty with a city warning when no shortened form matches", async () => {
    const loadStores = vi.fn().mockResolvedValue([]);
    const result = await resolveStoreLocation({ city: "אטלנטיס העיר האבודה" }, loadStores);

    expect(result.stores).toEqual([]);
    expect(result.location.scope).toBe("city");
    expect(result.location.fallbackApplied).toBe(false);
    expect(result.location.warning).toBe("no stores matched city 'אטלנטיס העיר האבודה'");
  });

  it("keeps near-only strict but warns when no store has coordinates", async () => {
    const loadStores = vi
      .fn()
      .mockResolvedValueOnce([]) // requested near query
      .mockResolvedValueOnce([store(), store()]); // unscoped reload, no coordinates

    const result = await resolveStoreLocation(
      { near: { lat: 32.16, lng: 34.84 }, radiusKm: 5 },
      loadStores,
    );

    expect(result.stores).toEqual([]);
    expect(result.location.scope).toBe("near");
    expect(result.location.fallbackApplied).toBe(false);
    expect(result.location.warning).toBe("store coordinates unavailable; use city instead");
  });

  it("warns about the radius when some stores have coordinates but none are in range", async () => {
    const loadStores = vi
      .fn()
      .mockResolvedValueOnce([]) // requested near query
      .mockResolvedValueOnce([store({ lat: 32.5, lng: 34.9 })]); // unscoped reload, has coordinates

    const result = await resolveStoreLocation(
      { near: { lat: 32.16, lng: 34.84 }, radiusKm: 5 },
      loadStores,
    );

    expect(result.stores).toEqual([]);
    expect(result.location.scope).toBe("near");
    expect(result.location.fallbackApplied).toBe(false);
    expect(result.location.warning).toBe("no stores within 5km");
  });

  it("marks distanceReliable true when near is not requested", async () => {
    const loadStores = vi.fn().mockResolvedValue([store({ city: "Herzliya" })]);
    const result = await resolveStoreLocation({ city: "Herzliya" }, loadStores);
    expect(result.location.distanceReliable).toBe(true);
    expect(result.location.warning).toBeNull();
  });

  it("suppresses distance ranking when every geocoded store is a city_centroid", async () => {
    const loadStores = vi.fn().mockResolvedValue([
      store({
        id: "11111111-1111-4111-8111-111111111111",
        lat: 32.16,
        lng: 34.84,
        geoSource: "city_centroid",
        distanceKm: 1.2,
      }),
      store({
        id: "22222222-2222-4222-8222-222222222222",
        lat: 32.16,
        lng: 34.84,
        geoSource: "city_centroid",
        distanceKm: 1.2,
      }),
    ]);

    const result = await resolveStoreLocation(
      { near: { lat: 32.17, lng: 34.85 }, radiusKm: 10 },
      loadStores,
    );

    expect(result.location.distanceReliable).toBe(false);
    expect(result.location.precision).toBe("city");
    expect(result.location.warning).toMatch(/city-level centroids/i);
  });

  it("keeps distanceReliable when at least one store has address geo", async () => {
    const loadStores = vi.fn().mockResolvedValue([
      store({
        id: "11111111-1111-4111-8111-111111111111",
        lat: 32.16,
        lng: 34.84,
        geoSource: "city_centroid",
        distanceKm: 2,
      }),
      store({
        id: "22222222-2222-4222-8222-222222222222",
        lat: 32.165,
        lng: 34.845,
        geoSource: "address",
        distanceKm: 0.4,
      }),
    ]);

    const result = await resolveStoreLocation(
      { city: "Herzliya", near: { lat: 32.17, lng: 34.85 }, radiusKm: 5 },
      loadStores,
    );

    expect(result.location.distanceReliable).toBe(true);
    expect(result.location.precision).toBe("radius");
    expect(result.location.warning).toBeNull();
  });

  it("rejects known out-of-radius branches from a reliable near scope", async () => {
    const near = { lat: 32.0819, lng: 34.7712 };
    const loadStores = vi.fn().mockResolvedValue([
      store({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Dizengoff",
        city: "תל אביב",
        lat: 32.08,
        lng: 34.775,
        geoSource: "address",
        distanceKm: 0.8,
      }),
      store({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "תלפיות",
        city: "ירושלים",
        lat: 31.75,
        lng: 35.21,
        geoSource: "address",
        distanceKm: 55,
      }),
      store({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "באר יעקב",
        city: "באר יעקב",
        lat: 31.94,
        lng: 34.84,
        geoSource: "address",
        distanceKm: 18,
      }),
    ]);

    const result = await resolveStoreLocation({ near, radiusKm: 3 }, loadStores);

    expect(result.stores.map((s) => s.name)).toEqual(["Dizengoff"]);
    expect(result.stores.every((s) => (s.distanceKm ?? Infinity) <= 3)).toBe(true);
  });

  it("isEligibleForDistanceRecommendation requires in-radius branch geo when reliable", () => {
    const location: StoreLocationMetadata = {
      scope: "near",
      precision: "radius",
      fallbackApplied: false,
      warning: null,
      distanceReliable: true,
      requested: {
        city: null,
        near: { lat: 32.0819, lng: 34.7712 },
        radiusKm: 3,
      },
    };
    expect(
      isEligibleForDistanceRecommendation(
        store({
          geoSource: "address",
          distanceKm: 1.2,
          lat: 32.08,
          lng: 34.77,
        }),
        location,
      ),
    ).toBe(true);
    expect(
      isEligibleForDistanceRecommendation(
        store({ geoSource: "address", distanceKm: 12, name: "תלפיות" }),
        location,
      ),
    ).toBe(false);
    expect(
      isEligibleForDistanceRecommendation(
        store({ geoSource: "city_centroid", distanceKm: 1, lat: 32.08, lng: 34.77 }),
        location,
      ),
    ).toBe(false);
    expect(
      isEligibleForDistanceRecommendation(
        store({ geoSource: "address", distanceKm: null, lat: 32.08, lng: 34.77 }),
        location,
      ),
    ).toBe(false);
  });

  it("isEligibleForDistanceRecommendation uses city membership when distance is unreliable", () => {
    const location: StoreLocationMetadata = {
      scope: "city",
      precision: "city",
      fallbackApplied: true,
      warning: "city-level",
      distanceReliable: false,
      requested: {
        city: "הרצליה",
        near: { lat: 32.16, lng: 34.84 },
        radiusKm: 3,
      },
    };
    expect(
      isEligibleForDistanceRecommendation(store({ city: "הרצליה", distanceKm: 40 }), location),
    ).toBe(true);
    expect(
      isEligibleForDistanceRecommendation(store({ city: "תל אביב", distanceKm: 1 }), location),
    ).toBe(false);
  });
});
