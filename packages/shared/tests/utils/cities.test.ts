import { describe, expect, it } from "vitest";
import {
  canonicalizeCity,
  cityMatchKeys,
  displayCity,
  extractCityFromLocation,
} from "../../src/utils/cities.js";

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

  it("drops the bare-zero null-city placeholder instead of storing '0'", () => {
    expect(canonicalizeCity("0")).toBeUndefined();
    expect(canonicalizeCity("000")).toBeUndefined();
    expect(canonicalizeCity(" 0 ")).toBeUndefined();
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

describe("extractCityFromLocation", () => {
  it("extracts canonical cities from free-text addresses via longest word-boundary match", () => {
    expect(extractCityFromLocation("רחוב בן גוריון, תל אביב")).toBe("תל אביב-יפו");
    expect(extractCityFromLocation("אני גר במרכז תל אביב ליד בן גוריון")).toBe("תל אביב-יפו");
    expect(extractCityFromLocation("נווה עמל, הרצליה")).toBe("הרצליה");
    expect(extractCityFromLocation("אזור תעשייה ליד הרצליה")).toBe("הרצליה");
    expect(extractCityFromLocation("אזור תעשייה")).toBeNull();
  });
});

describe("spacing around a hyphen is typography, not identity", () => {
  it("reads a retailer's spaced spelling as the same place", () => {
    // Rami Levy's delivery page writes "תל אביב - יפו". Until this normalised,
    // that was a different place from "תל אביב-יפו", so the chain's own coverage
    // list reported that it does not deliver to Tel Aviv.
    expect(canonicalizeCity("תל אביב - יפו")).toBe("תל אביב-יפו");
    expect(canonicalizeCity("תל אביב-יפו")).toBe("תל אביב-יפו");
    expect(canonicalizeCity("תל אביב")).toBe("תל אביב-יפו");
  });

  it("still tells two genuinely different places apart", () => {
    expect(canonicalizeCity("רמת גן")).not.toBe(canonicalizeCity("רמת השרון"));
  });
});

describe("a street named after a place is not that place", () => {
  it("does not read a boulevard's name as the city", () => {
    // "שדרות" is both the word for boulevard and a town, and it is a longer
    // alias than אילת or חיפה, so it won every address it appeared in: an Eilat
    // basket was priced against a town 200km away, and so was a Haifa one.
    expect(extractCityFromLocation("שדרות התמרים 1, אילת")).toBe("אילת");
    expect(extractCityFromLocation("שדרות בן גוריון 12, חיפה")).toBe("חיפה");
    expect(extractCityFromLocation("שדרות רוטשילד 20, תל אביב")).toBe("תל אביב-יפו");
  });

  it("does not read a street named after another city as that city", () => {
    expect(extractCityFromLocation("שדרות ירושלים 5, בת ים")).toBe("בת ים");
    expect(extractCityFromLocation("רחוב ירושלים 3, רמת גן")).toBe("רמת גן");
  });

  it("still finds the town when the street word IS the town", () => {
    expect(extractCityFromLocation("שדרות ניצנים 3, שדרות")).toBe("שדרות");
    expect(extractCityFromLocation("שדרות")).toBe("שדרות");
    expect(extractCityFromLocation("שדרות, ישראל")).toBe("שדרות");
    // A street named for the city it is in still resolves to that city.
    expect(extractCityFromLocation("שדרות ירושלים 5, ירושלים")).toBe("ירושלים");
  });
});
