import { describe, expect, it } from "vitest";
import { DEFAULT_RADIUS_KM, resolveRadiusKm } from "../../src/lib/defaults.js";

describe("resolveRadiusKm", () => {
  it("defaults to 10km when near is set and radius omitted", () => {
    expect(resolveRadiusKm({ lat: 32, lng: 34 }, undefined)).toBe(DEFAULT_RADIUS_KM);
    expect(DEFAULT_RADIUS_KM).toBe(10);
  });

  it("keeps an explicit radius", () => {
    expect(resolveRadiusKm({ lat: 32, lng: 34 }, 25)).toBe(25);
  });

  it("leaves radius undefined without near", () => {
    expect(resolveRadiusKm(undefined, undefined)).toBeUndefined();
    expect(resolveRadiusKm(undefined, 25)).toBe(25);
  });
});
