import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import {
  geocodeCacheKey,
  normalizeGeocodeQuery,
  ttlMsFor,
} from "../../src/queries/geocodeCache.js";
import {
  _resetNominatimStateForTests,
  precisionFromNominatim,
} from "../../src/queries/nominatim.js";
import { resolveGeocodeQuery } from "../../src/queries/resolveGeocodeQuery.js";

const SECRET = "test-only-geocoding-cache-secret-32b!";

function mockFetchJson(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });
}

describe("geocodeCacheKey / normalize", () => {
  beforeEach(() => {
    process.env.GEOCODING_CACHE_SECRET = SECRET;
  });

  it("normalizes whitespace and NFC without retaining the raw address in the key", () => {
    const raw = "  נווה   עמל  ";
    const key = geocodeCacheKey(raw, "הרצליה");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("נווה");
    expect(key).not.toContain("עמל");
    expect(normalizeGeocodeQuery(raw)).toBe("נווה עמל");
    // Same normalized input → same key.
    expect(geocodeCacheKey("נווה עמל", "הרצליה")).toBe(key);
    // Different city hint → different key.
    expect(geocodeCacheKey("נווה עמל", "תל אביב-יפו")).not.toBe(key);
  });

  it("uses distinct TTLs for positive / negative / city-centroid", () => {
    expect(ttlMsFor("hit", "nominatim")).toBe(90 * 24 * 60 * 60 * 1000);
    expect(ttlMsFor("miss", "nominatim")).toBe(24 * 60 * 60 * 1000);
    expect(ttlMsFor("hit", "city_centroid")).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

describe("precisionFromNominatim", () => {
  it("maps OSM types onto coarse precision buckets", () => {
    expect(precisionFromNominatim({ addresstype: "house" })).toBe("address");
    expect(precisionFromNominatim({ type: "road" })).toBe("street");
    expect(precisionFromNominatim({ addresstype: "suburb" })).toBe("neighborhood");
    expect(precisionFromNominatim({ addresstype: "city" })).toBe("city");
    expect(precisionFromNominatim({ place_rank: 30 })).toBe("address");
    expect(precisionFromNominatim({ place_rank: 14 })).toBe("city");
  });
});

describe("resolveGeocodeQuery", () => {
  beforeEach(() => {
    process.env.GEOCODING_CACHE_SECRET = SECRET;
    process.env.NOMINATIM_MIN_INTERVAL_MS = "1000";
    query.mockReset();
    _resetNominatimStateForTests();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetNominatimStateForTests();
  });

  it("fast strategy returns embedded-city centroid without calling Nominatim", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // cache miss

    const result = await resolveGeocodeQuery({
      location: "רחוב בן גוריון, תל אביב",
      strategy: "fast",
    });

    expect(result).toMatchObject({
      status: "ok",
      precision: "city",
      provider: "city_centroid",
      fallbackApplied: true,
    });
    expect(result.cached).toBe(false);
    expect(result.displayName).toBe("תל אביב-יפו");
    expect(result.warning).toBe(
      "Using city-level location for a faster estimate; distances are approximate.",
    );
    expect(fetch).not.toHaveBeenCalled();
    // Fast city-centroid must not be persisted as a positive geocode hit.
    expect(query.mock.calls.length).toBe(1);
    expect(String(query.mock.calls[0]![0])).toMatch(/SELECT/i);
  });

  it("returns a cache hit without calling Nominatim", async () => {
    const key = geocodeCacheKey("נווה עמל", "הרצליה");
    query
      .mockResolvedValueOnce({
        rows: [
          {
            query_key: key,
            display_name: "Neve Amal, Herzliya",
            lat: 32.17,
            lng: 34.84,
            precision: "neighborhood",
            provider: "nominatim",
            status: "hit",
            expires_at: new Date(Date.now() + 60_000),
            hits: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    expect(result.status).toBe("ok");
    expect(result.cached).toBe(true);
    expect(result.point).toEqual({ lat: 32.17, lng: 34.84 });
    expect(result.precision).toBe("neighborhood");
    expect(result.attribution).toContain("OpenStreetMap");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches Nominatim on miss, validates Israel bounds, and caches the hit", async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // cache miss
      .mockResolvedValueOnce({ rowCount: 1 }); // put cache

    vi.mocked(fetch).mockImplementation(
      mockFetchJson(200, [
        {
          lat: "32.1656",
          lon: "34.8469",
          display_name: "Herzliya, Israel",
          addresstype: "city",
        },
      ]),
    );

    const result = await resolveGeocodeQuery({ location: "הרצליה" });
    expect(result.status).toBe("ok");
    expect(result.cached).toBe(false);
    expect(result.provider).toBe("nominatim");
    expect(result.precision).toBe("city");
    expect(result.point?.lat).toBeCloseTo(32.1656, 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    // putGeocodeCache was called with hit status.
    const putSql = String(query.mock.calls[1]![0]);
    expect(putSql).toContain("INSERT INTO geocode_cache");
    expect(query.mock.calls[1]![1]).toEqual(
      expect.arrayContaining(["hit", "nominatim", "city"]),
    );
  });

  it("rejects out-of-Israel Nominatim hits as empty and negative-caches", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(fetch).mockImplementation(
      mockFetchJson(200, [{ lat: "48.8566", lon: "2.3522", addresstype: "city" }]),
    );

    const result = await resolveGeocodeQuery({ location: "Paris France" });
    expect(result.status).toBe("not_found");
    expect(result.point).toBeNull();
    expect(query.mock.calls[1]![1]).toEqual(expect.arrayContaining(["miss", "nominatim"]));
  });

  it("falls back to city centroid when Nominatim is unavailable and city is known", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    vi.mocked(fetch).mockImplementation(mockFetchJson(503, { error: "busy" }));

    const result = await resolveGeocodeQuery({
      location: "נווה עמל",
      city: "הרצליה",
    });
    expect(result.status).toBe("ok");
    expect(result.fallbackApplied).toBe(true);
    expect(result.provider).toBe("city_centroid");
    expect(result.precision).toBe("city");
    expect(result.warning).toMatch(/unavailable/i);
    // No negative cache on provider failure.
    expect(query.mock.calls.length).toBe(1);
  });

  it("returns unavailable when Nominatim fails and no city fallback exists", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    vi.mocked(fetch).mockImplementation(
      () => Promise.reject(new Error("timeout")) as never,
    );

    const result = await resolveGeocodeQuery({ location: "נווה עמל בלי עיר" });
    expect(result.status).toBe("unavailable");
    expect(result.point).toBeNull();
  });

  it("falls back to city centroid on confirmed empty when city is known", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(fetch).mockImplementation(mockFetchJson(200, []));

    const result = await resolveGeocodeQuery({
      location: "רחוב שלא קיים 999",
      city: "הרצליה",
    });
    expect(result.status).toBe("ok");
    expect(result.provider).toBe("city_centroid");
    expect(result.fallbackApplied).toBe(true);
    expect(query.mock.calls[1]![1]).toEqual(
      expect.arrayContaining(["hit", "city_centroid", "city"]),
    );
  });

  it("downgrades a fresh Nominatim hit to city precision when the resolved area is a different neighborhood", async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // cache miss
      .mockResolvedValueOnce({ rowCount: 1 }); // put cache
    // "נווה עמל" mis-resolves to a post office in "נווה עובד" (~1km off) at address precision.
    vi.mocked(fetch).mockImplementation(
      mockFetchJson(200, [
        {
          lat: "32.1667398",
          lon: "34.8477053",
          display_name: "בית הדואר הרצליה, 68, סוקולוב, נווה עובד, הרצליה, ישראל",
          type: "post_office",
          place_rank: 30,
        },
      ]),
    );

    const result = await resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    expect(result.status).toBe("ok");
    expect(result.provider).toBe("nominatim");
    // Raw Nominatim precision was "address"; downgraded because "עמל" is absent from the result.
    expect(result.precision).toBe("city");
    expect(result.warning).toMatch(/approximate|different/i);
    expect(result.point?.lat).toBeCloseTo(32.1667, 3);
    // The cache still records the RAW nominatim precision; the downgrade is response-only.
    expect(query.mock.calls[1]![1]).toEqual(
      expect.arrayContaining(["hit", "nominatim", "address"]),
    );
  });

  it("retroactively downgrades a cached wrong-neighborhood address hit", async () => {
    const key = geocodeCacheKey("נווה עמל", "הרצליה");
    query
      .mockResolvedValueOnce({
        rows: [
          {
            query_key: key,
            display_name: "בית הדואר הרצליה, 68, סוקולוב, נווה עובד, הרצליה, ישראל",
            lat: 32.1667398,
            lng: 34.8477053,
            precision: "address",
            provider: "nominatim",
            status: "hit",
            expires_at: new Date(Date.now() + 60_000),
            hits: 5,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // hits bump

    const result = await resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    expect(result.cached).toBe(true);
    expect(result.precision).toBe("city");
    expect(result.warning).toMatch(/approximate|different/i);
    expect(result.point).toEqual({ lat: 32.1667398, lng: 34.8477053 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves precision when the resolved area matches the requested neighborhood", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(fetch).mockImplementation(
      mockFetchJson(200, [
        {
          lat: "32.1674937",
          lon: "34.8578354",
          display_name: "נווה עמל, הרצליה, נפת תל אביב, ישראל",
          addresstype: "suburb",
        },
      ]),
    );

    const result = await resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    expect(result.precision).toBe("neighborhood");
    expect(result.warning).toBeNull();
  });

  it("does not downgrade when the display name is transliterated (script mismatch)", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(fetch).mockImplementation(
      mockFetchJson(200, [
        {
          lat: "32.1674937",
          lon: "34.8578354",
          display_name: "Neve Oved, Herzliya, Israel",
          addresstype: "suburb",
        },
      ]),
    );

    const result = await resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    // Cannot compare Hebrew query tokens against a Latin display name — stay conservative.
    expect(result.precision).toBe("neighborhood");
    expect(result.warning).toBeNull();
  });

  it("serializes Nominatim calls with ≥1s spacing", async () => {
    process.env.NOMINATIM_MIN_INTERVAL_MS = "1000";
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT")) return { rows: [] };
      return { rowCount: 1 };
    });
    const timestamps: number[] = [];
    vi.mocked(fetch).mockImplementation(async () => {
      timestamps.push(Date.now());
      return {
        ok: true,
        status: 200,
        json: async () => [
          { lat: "32.1656", lon: "34.8469", addresstype: "city", display_name: "Herzliya" },
        ],
      } as never;
    });

    await resolveGeocodeQuery({ location: "הרצליה א" });
    await resolveGeocodeQuery({ location: "הרצליה ב" });
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(950);
  });

  it("coalesces concurrent identical lookups into one fetch", async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT")) return { rows: [] };
      return { rowCount: 1 };
    });

    let resolveFetch!: (v: unknown) => void;
    const fetchPromise = new Promise((r) => {
      resolveFetch = r;
    });
    vi.mocked(fetch).mockImplementation(
      () =>
        fetchPromise.then(() => ({
          ok: true,
          status: 200,
          json: async () => [
            {
              lat: "32.1656",
              lon: "34.8469",
              addresstype: "suburb",
              display_name: "Neve Amal",
            },
          ],
        })) as never,
    );

    const a = resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    const b = resolveGeocodeQuery({ location: "נווה עמל", city: "הרצליה" });
    // Allow both to enter inflight before resolving fetch.
    await Promise.resolve();
    await Promise.resolve();
    resolveFetch(undefined);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe("ok");
    expect(rb.status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
