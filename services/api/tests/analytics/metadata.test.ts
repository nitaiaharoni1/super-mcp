import { describe, expect, it } from "vitest";
import {
  extractRequestMeta,
  extractRestRequestMeta,
  extractResultMeta,
  shouldTrackRestPath,
} from "../../src/analytics/metadata.js";

describe("analytics metadata extractors", () => {
  it("extracts counts and location flags without string values", () => {
    const meta = extractRequestMeta({
      items: [{ query: "חלב" }, { query: "לחם" }],
      city: "הרצליה",
      near: { lat: 32.1, lng: 34.8 },
      location: "נווה עמל",
    });

    expect(meta).toEqual({
      item_count: 2,
      has_city: true,
      has_near: true,
      has_location: true,
    });
    expect(JSON.stringify(meta)).not.toContain("חלב");
    expect(JSON.stringify(meta)).not.toContain("הרצליה");
    expect(JSON.stringify(meta)).not.toContain("נווה");
  });

  it("treats empty city/location as absent", () => {
    expect(
      extractRequestMeta({
        city: "",
        location: "",
        near: null,
      }),
    ).toEqual({
      has_city: false,
      has_near: false,
      has_location: false,
    });
  });

  it("merges REST body + query location flags", () => {
    expect(
      extractRestRequestMeta({ items: [{ product_id: "x" }] }, { city: "Tel Aviv", near: "32,34" }),
    ).toEqual({
      item_count: 1,
      has_city: true,
      has_near: true,
    });
  });

  it("extracts basket_status from result only", () => {
    expect(extractResultMeta({ status: "needs_confirmation", questions: [] })).toEqual({
      basket_status: "needs_confirmation",
    });
    expect(extractResultMeta({ status: "complete" })).toEqual({ basket_status: "complete" });
    expect(extractResultMeta({ ok: true })).toEqual({});
  });

  it("tracks shopping REST paths and skips admin/public", () => {
    expect(shouldTrackRestPath("/v1/basket/optimize")).toBe(true);
    expect(shouldTrackRestPath("/v1/products/search")).toBe(true);
    expect(shouldTrackRestPath("/v1/admin/keys")).toBe(false);
    expect(shouldTrackRestPath("/health")).toBe(false);
    expect(shouldTrackRestPath("/mcp")).toBe(false);
  });
});
