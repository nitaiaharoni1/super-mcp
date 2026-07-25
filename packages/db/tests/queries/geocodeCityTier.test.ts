import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("../../src/client/index.js", () => ({
  getPool: () => ({ query }),
}));

const { backfillCityFromStoreName, backfillCentroids } = await import(
  "../../src/queries/geocode.js"
);

type StoreRowStub = {
  id: string;
  name: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geo_source: string | null;
  chain_name_he: string | null;
  chain_name_en: string | null;
};

function row(partial: Partial<StoreRowStub> & { id: string }): StoreRowStub {
  return {
    name: null,
    city: null,
    address: null,
    lat: null,
    lng: null,
    geo_source: null,
    chain_name_he: null,
    chain_name_en: null,
    ...partial,
  };
}

/** First call is the SELECT; every later call is an UPDATE. */
function respondWith(rows: StoreRowStub[]): void {
  query.mockReset();
  query.mockImplementation((sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return Promise.resolve({ rows });
    return Promise.resolve({ rows: [] });
  });
}

function updateCalls(): Array<[string, unknown[]]> {
  return query.mock.calls.filter(([sql]) => /^\s*UPDATE/i.test(String(sql))) as Array<
    [string, unknown[]]
  >;
}

beforeEach(() => {
  query.mockReset();
});

describe("backfillCityFromStoreName", () => {
  it("recovers a city from the branch name and persists it", async () => {
    respondWith([
      row({ id: "s1", name: "רמת השרון" }),
      row({ id: "s2", name: "ירושלים תלפיות" }),
    ]);

    const result = await backfillCityFromStoreName();

    expect(result).toMatchObject({ scanned: 2, updated: 2, unresolved: 0 });
    expect(updateCalls().map((call) => call[1])).toEqual([
      ["רמת השרון", "s1"],
      ["ירושלים", "s2"],
    ]);
  });

  it("leaves an unrecognizable name null rather than guessing a town", async () => {
    // A wrong city produces confidently wrong distances, which is worse than
    // leaving the branch unlocated.
    respondWith([row({ id: "s1", name: "Store 799" }), row({ id: "s2", name: "אחד העם" })]);

    const result = await backfillCityFromStoreName();

    expect(result).toMatchObject({ scanned: 2, updated: 0, unresolved: 2 });
    expect(updateCalls()).toHaveLength(0);
    expect(result.topUnresolved).toContain("Store 799:1");
  });

  it("writes nothing on a dry run but still reports what it would do", async () => {
    respondWith([row({ id: "s1", name: "רעננה" })]);

    const result = await backfillCityFromStoreName({ dryRun: true });

    expect(result).toMatchObject({ scanned: 1, updated: 1, unresolved: 0 });
    expect(updateCalls()).toHaveLength(0);
  });

  it("selects rows whose city is null, blank, or the feed's zero placeholder", async () => {
    respondWith([]);
    await backfillCityFromStoreName();
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toMatch(/city IS NULL/);
    expect(sql).toMatch(/btrim\(city\) = ''/);
    expect(sql).toMatch(/\^0\+\$/);
  });
});

describe("backfillCentroids name fallback", () => {
  it("stamps a centroid using the branch name when the city column is empty", async () => {
    respondWith([row({ id: "s1", name: "חולון המרכבה", city: null })]);

    const result = await backfillCentroids();

    expect(result).toMatchObject({ scanned: 1, updated: 1, unmapped: 0 });
    // geo_source is literal in this tier's SQL, so params are [lat, lng, id].
    const [sql, params] = updateCalls()[0]!;
    expect(sql).toContain("geo_source = 'city_centroid'");
    expect(params[0]).toBeCloseTo(32.0193, 3);
    expect(params[1]).toBeCloseTo(34.7804, 3);
    expect(params[2]).toBe("s1");
  });

  it("still counts a row unmapped when neither city nor name resolves", async () => {
    respondWith([row({ id: "s1", name: "Store 132", city: null })]);

    const result = await backfillCentroids();

    expect(result).toMatchObject({ scanned: 1, updated: 0, unmapped: 1 });
    expect(updateCalls()).toHaveLength(0);
  });

  it("prefers the stored city over the branch name when both resolve", async () => {
    // The feed's own city is authoritative; the name is only a fallback.
    respondWith([row({ id: "s1", name: "רעננה", city: "הרצליה" })]);

    await backfillCentroids();

    const [, params] = updateCalls()[0]!;
    expect(params[0]).toBeCloseTo(32.1656, 4);
    expect(params[1]).toBeCloseTo(34.8469, 4);
  });
});
