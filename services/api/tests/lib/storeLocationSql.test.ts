import { describe, expect, it } from "vitest";
import { storeLocationAndClause, storeLocationSql } from "../../src/lib/storeLocationSql.js";

describe("storeLocationSql", () => {
  it("builds city and near filters with distance select", () => {
    const params: unknown[] = ["product-id"];
    const sql = storeLocationSql({ city: "Herzliya", near: { lat: 32.16, lng: 34.84 }, radiusKm: 5 }, params);

    expect(sql.conditions).toHaveLength(3);
    expect(sql.distanceSelect).toContain("6371 * acos");
    expect(params).toHaveLength(5);
    expect(storeLocationAndClause(sql)).toMatch(/^AND /);
  });

  it("returns empty AND clause when no location filters", () => {
    const params: unknown[] = [];
    const sql = storeLocationSql({}, params);
    expect(sql.conditions).toHaveLength(0);
    expect(storeLocationAndClause(sql)).toBe("");
  });
});
