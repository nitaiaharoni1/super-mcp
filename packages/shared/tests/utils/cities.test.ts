import { describe, expect, it } from "vitest";
import { canonicalizeCity, cityMatchKeys, displayCity } from "../../src/utils/cities.js";

describe("canonicalizeCity", () => {
  it("maps CBS locality codes to Hebrew", () => {
    expect(canonicalizeCity("6400")).toBe("הרצליה");
    expect(canonicalizeCity("5000")).toBe("תל אביב-יפו");
    expect(canonicalizeCity("3000")).toBe("ירושלים");
  });

  it("maps English and spelling aliases", () => {
    expect(canonicalizeCity("Herzliya")).toBe("הרצליה");
    expect(canonicalizeCity("herzeliya")).toBe("הרצליה");
    expect(canonicalizeCity("Tel Aviv")).toBe("תל אביב-יפו");
    expect(canonicalizeCity("פתח תקוה")).toBe("פתח תקווה");
  });

  it("keeps unknown free text", () => {
    expect(canonicalizeCity("אילת")).toBe("אילת");
  });
});

describe("cityMatchKeys", () => {
  it("expands Herzliya NL + code so one filter hits both DB forms", () => {
    const keys = cityMatchKeys("הרצליה");
    expect(keys).toContain("הרצליה");
    expect(keys).toContain("6400");
    expect(cityMatchKeys("Herzliya")).toEqual(expect.arrayContaining(["הרצליה", "6400"]));
    expect(cityMatchKeys("6400")).toEqual(expect.arrayContaining(["הרצליה", "6400"]));
  });
});

describe("displayCity", () => {
  it("shows Hebrew for coded cities", () => {
    expect(displayCity("6400")).toBe("הרצליה");
  });
});
