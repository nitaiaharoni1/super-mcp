import { describe, expect, it } from "vitest";
import { evaluateCoverage, type CoverageRule } from "../../src/fulfillment/coverage.js";

/** Roughly Dizengoff Center, Tel Aviv. */
const TEL_AVIV = { lat: 32.0754, lng: 34.7749 };
/** Beer Sheva centre. */
const BEER_SHEVA = { lat: 31.2518, lng: 34.7913 };

const national: CoverageRule = { scope: "national", confidence: "reported" };

describe("coverage scopes", () => {
  it("serves everywhere when the retailer says national", () => {
    expect(evaluateCoverage([national], { city: "באר שבע" })).toEqual({
      serves: true,
      matchedScope: "national",
      confidence: "reported",
    });
  });

  it("matches a named settlement regardless of how the shopper spells it", () => {
    // Rami Levy publishes a list of towns, not geometry, so the city key has to
    // absorb 'תל אביב' / 'תל אביב-יפו' / 'Tel Aviv' being the same place.
    const rules: CoverageRule[] = [
      { scope: "city", cityKey: "תל אביב-יפו", confidence: "verified" },
    ];
    expect(evaluateCoverage(rules, { city: "תל אביב" }).serves).toBe(true);
    expect(evaluateCoverage(rules, { city: "Tel Aviv" }).serves).toBe(true);
    expect(evaluateCoverage(rules, { city: "חיפה" })).toEqual({
      serves: false,
      reason: "outside_service_area",
    });
  });

  it("measures a radius from a regional depot", () => {
    const rules: CoverageRule[] = [
      {
        scope: "radius",
        centerLat: 32.0853,
        centerLng: 34.7818,
        radiusKm: 25,
        confidence: "estimated",
      },
    ];
    expect(evaluateCoverage(rules, TEL_AVIV).serves).toBe(true);
    // Beer Sheva is ~93 km away; a depot in Tel Aviv does not reach it.
    expect(evaluateCoverage(rules, BEER_SHEVA).serves).toBe(false);
  });
});

describe("polygon coverage", () => {
  // GeoJSON is [lng, lat] — reversed from every other coordinate here. A square
  // around central Tel Aviv.
  const square: CoverageRule = {
    scope: "polygon",
    confidence: "verified",
    geojson: {
      type: "Polygon",
      coordinates: [
        [
          [34.75, 32.05],
          [34.80, 32.05],
          [34.80, 32.10],
          [34.75, 32.10],
          [34.75, 32.05],
        ],
      ],
    },
  };

  it("includes a point inside the published service area", () => {
    expect(evaluateCoverage([square], TEL_AVIV)).toMatchObject({ serves: true, matchedScope: "polygon" });
  });

  it("excludes a point outside it", () => {
    expect(evaluateCoverage([square], { lat: 32.2, lng: 34.9 })).toEqual({
      serves: false,
      reason: "outside_service_area",
    });
  });

  it("does not silently swap lat and lng", () => {
    // The failure this guards against puts Tel Aviv in the Mediterranean and
    // still returns a confident boolean.
    expect(evaluateCoverage([square], { lat: 34.7749, lng: 32.0754 }).serves).toBe(false);
  });

  it("reads a MultiPolygon's first ring", () => {
    const multi: CoverageRule = {
      ...square,
      geojson: {
        type: "MultiPolygon",
        coordinates: [(square.geojson as { coordinates: unknown[] }).coordinates],
      },
    };
    expect(evaluateCoverage([multi], TEL_AVIV).serves).toBe(true);
  });
});

describe("what we do not know", () => {
  it("distinguishes 'no coverage recorded' from 'does not deliver there'", () => {
    // Reporting a gap in our own data as a refusal by the retailer would hide a
    // real option and sound authoritative doing it.
    expect(evaluateCoverage([], TEL_AVIV)).toEqual({ serves: false, reason: "coverage_unknown" });
  });

  it("asks for a better address rather than refusing, when the rule is untestable", () => {
    const rules: CoverageRule[] = [
      { scope: "radius", centerLat: 32.08, centerLng: 34.78, radiusKm: 20, confidence: "estimated" },
    ];
    expect(evaluateCoverage(rules, { city: "תל אביב" })).toEqual({
      serves: false,
      reason: "address_too_vague",
    });
  });

  it("still answers when one rule is testable and another is not", () => {
    const rules: CoverageRule[] = [
      { scope: "radius", centerLat: 32.08, centerLng: 34.78, radiusKm: 20, confidence: "estimated" },
      { scope: "city", cityKey: "תל אביב-יפו", confidence: "verified" },
    ];
    expect(evaluateCoverage(rules, { city: "תל אביב" })).toMatchObject({ serves: true });
  });

  it("reports the confidence of the rule that actually fired", () => {
    // A verified national claim and an estimated radius both matching must not
    // let the guess borrow the evidence of the statement, nor the reverse.
    const rules: CoverageRule[] = [
      { scope: "radius", centerLat: 32.08, centerLng: 34.78, radiusKm: 20, confidence: "estimated" },
      national,
    ];
    expect(evaluateCoverage(rules, TEL_AVIV)).toMatchObject({
      serves: true,
      confidence: "reported",
    });
  });
});
