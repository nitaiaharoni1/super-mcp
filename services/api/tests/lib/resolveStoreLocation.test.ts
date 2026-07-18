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
});
