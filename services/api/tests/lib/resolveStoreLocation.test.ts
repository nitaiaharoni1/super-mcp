import { describe, expect, it, vi } from "vitest";
import { resolveStoreLocation } from "../../src/lib/resolveStoreLocation.js";
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

  it("keeps near-only strict without a broad fallback", async () => {
    const loadStores = vi.fn().mockResolvedValue([]);
    const result = await resolveStoreLocation(
      { near: { lat: 32.16, lng: 34.84 }, radiusKm: 5 },
      loadStores,
    );

    expect(loadStores).toHaveBeenCalledOnce();
    expect(result.stores).toEqual([]);
    expect(result.location.scope).toBe("near");
    expect(result.location.fallbackApplied).toBe(false);
  });
});
