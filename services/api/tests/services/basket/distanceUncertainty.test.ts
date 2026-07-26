/**
 * A distance we did not measure must not be reported as one we did.
 *
 * 313 of 887 shoppable branches (36%) carry only a city centroid, not their own
 * coordinates. Their `distanceKm` was the distance from the shopper to the
 * MIDDLE OF THE CITY, reported to full float precision with nothing in the
 * number to say so.
 *
 * A shopper at Mendelson 1, Tel Aviv asked for a basket and was told
 * "ליקוט רמת החייל, 0.6149685404435874 km". Three different stores reported that
 * same figure, because 0.615 km is simply how far Mendelson 1 is from the Tel
 * Aviv centroid (32.0853, 34.7818). The real Ramat HaHayal branch sits at
 * 32.1137, 34.8414 — about 7 km away. The number understated by 11x, and it
 * understated in the one direction that costs the shopper a wasted drive.
 *
 * The bias is systematic, not random: a shopper living near their city centre
 * sees EVERY unlocated branch in that city as next door.
 *
 * Measured over the 499 located branches inside the coverage area, the RMS
 * distance from a branch to its city centroid is 2.60 km. That is the real
 * uncertainty, so it is what the estimate carries.
 */
import { describe, expect, it } from "vitest";
import {
  CITY_UNCERTAINTY_RADIUS_KM,
  estimatedDistanceKm,
} from "../../../src/services/basket/recommendStores.js";

/** How far Mendelson 1 actually is from the Tel Aviv centroid. */
const MENDELSON_TO_TLV_CENTROID_KM = 0.6149685404435874;

describe("a city-centroid distance carries its uncertainty", () => {
  it("stops reporting a store in the shopper's own city as next door", () => {
    const reported = estimatedDistanceKm(MENDELSON_TO_TLV_CENTROID_KM, "city");
    // The live bug: 0.61 km for a store roughly 7 km away.
    expect(reported).toBeGreaterThan(2);
    expect(reported).toBeCloseTo(2.67, 1);
  });

  it("never lets an unlocated store outrank a branch whose position we know", () => {
    // Eden Gan Ha'ir is 0.39 km away and its coordinates are real. The picking
    // depot sat at the centroid. Before the fix the depot won on distance.
    const knownBranch = estimatedDistanceKm(0.39, "branch");
    const unlocated = estimatedDistanceKm(MENDELSON_TO_TLV_CENTROID_KM, "city");
    expect(knownBranch).toBeLessThan(unlocated);
  });

  it("leaves a measured distance alone apart from false precision", () => {
    expect(estimatedDistanceKm(0.39, "branch")).toBe(0.39);
    expect(estimatedDistanceKm(7.06, "branch")).toBe(7.06);
    expect(estimatedDistanceKm(0, "branch")).toBe(0);
    // A straight line between coordinates held to ~5 decimals, and not a driving
    // route at that: the digits past 10 m were never information.
    expect(estimatedDistanceKm(0.39308716474430777, "branch")).toBe(0.39);
    expect(estimatedDistanceKm(2.528232305042477, "branch")).toBe(2.53);
  });

  it("lets the uncertainty fade as the store gets further away", () => {
    // Combining in quadrature, not by addition. Whether a store 40 km away sits
    // at one edge of its city or the other barely changes the trip, so the
    // penalty must not keep growing with distance — the old flat +3 km charged
    // a 40 km store as 43 km and distorted every long-range comparison.
    const far = estimatedDistanceKm(40, "city");
    expect(far).toBeGreaterThan(40);
    expect(far).toBeLessThan(40.1);
  });

  it("is dominated by the uncertainty when the shopper is at the centroid", () => {
    expect(estimatedDistanceKm(0, "city")).toBeCloseTo(CITY_UNCERTAINTY_RADIUS_KM, 5);
  });

  it("passes through a missing distance untouched, so callers still see null", () => {
    expect(estimatedDistanceKm(null, "city")).toBeNull();
    expect(estimatedDistanceKm(null, "unknown")).toBeNull();
  });

  it("rounds to a precision it can defend", () => {
    // 0.6149685404435874 claimed sixteen digits of a figure that is a guess.
    const reported = estimatedDistanceKm(MENDELSON_TO_TLV_CENTROID_KM, "city");
    expect(String(reported).replace(/^\d+\.?/, "").length).toBeLessThanOrEqual(2);
  });
});
