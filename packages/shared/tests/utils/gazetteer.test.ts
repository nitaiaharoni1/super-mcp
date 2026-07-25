import { describe, expect, it } from "vitest";
import {
  allCanonicalCities,
  canonicalizeCity,
  cityForNeighborhood,
  cityMatchKeys,
  extractCityFromLocation,
} from "../../src/utils/cities.js";
import { centroidForCity } from "../../src/utils/cityCentroids.js";
import { NEIGHBORHOOD_TO_CITY } from "../../src/utils/neighborhoods.js";
import { localityFromStoreName } from "../../src/utils/storeIdentity.js";

/**
 * The gazetteer, the centroid table, and the neighborhood layer are three
 * tables that only work together: a code with no canonical name, or a canonical
 * name with no centroid, still leaves a store ungeocodable. These assert they
 * stay in step, since drift is silent at runtime.
 */
describe("gazetteer / centroid table integrity", () => {
  it("gives every canonical locality a centroid", () => {
    const missing = allCanonicalCities().filter((city) => centroidForCity(city) === null);
    expect(missing, `localities without a centroid: ${missing.join(", ")}`).toEqual([]);
  });

  it("resolves every neighborhood to a locality that has a centroid", () => {
    const broken = Object.entries(NEIGHBORHOOD_TO_CITY).filter(
      ([, city]) => centroidForCity(city) === null,
    );
    expect(broken, `neighborhoods pointing at uncentroided cities: ${broken.join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps cityMatchKeys free of synthetic non-numeric codes", () => {
    // Localities with no CBS code live in a separate list precisely so they
    // never leak a fake code into a SQL `city = ANY(...)` filter.
    for (const key of cityMatchKeys("נצרת")) {
      expect(key).not.toMatch(/^-/);
    }
  });
});

describe("gazetteer long-tail additions", () => {
  it("resolves CBS codes that previously had no mapping", () => {
    // Each of these was cross-checked against the branch name/address of the
    // very store rows that carry the code.
    expect(canonicalizeCity("2550")).toBe("גדרה");
    expect(canonicalizeCity("2200")).toBe("דימונה");
    expect(canonicalizeCity("1063")).toBe("מעלות תרשיחא");
    expect(canonicalizeCity("469")).toBe("קריית עקרון");
    expect(canonicalizeCity("3797")).toBe("מודיעין עילית");
    expect(canonicalizeCity("166")).toBe("גן יבנה");
  });

  it("gives those codes a usable centroid", () => {
    for (const code of ["2550", "2200", "1063", "469", "3797", "166"]) {
      expect(centroidForCity(code), `code ${code}`).not.toBeNull();
    }
  });

  it("distinguishes גן יבנה from יבנה instead of collapsing them", () => {
    // Longest-first matching: "יבנה" is a substring of "גן יבנה" but they are
    // different localities ~10km apart, so the longer phrase must win.
    expect(extractCityFromLocation("גן יבנה")).toBe("גן יבנה");
    expect(extractCityFromLocation("יבנה")).toBe("יבנה");
    expect(centroidForCity("גן יבנה")).not.toEqual(centroidForCity("יבנה"));
  });

  it("maps the one-yud קרית spellings feeds actually emit", () => {
    expect(canonicalizeCity("קרית שמונה")).toBe("קריית שמונה");
    expect(canonicalizeCity("קרית עקרון")).toBe("קריית עקרון");
    expect(canonicalizeCity("קרית אתא")).toBe("קריית אתא");
  });

  it("keeps נצרת עילית pointing at its current name נוף הגליל", () => {
    // The two-word form must outrank the bare נצרת locality added alongside it.
    expect(extractCityFromLocation("נצרת עילית")).toBe("נוף הגליל");
    expect(extractCityFromLocation("נצרת")).toBe("נצרת");
  });
});

describe("cityForNeighborhood", () => {
  it("resolves a neighborhood to its parent locality", () => {
    expect(cityForNeighborhood("נווה זמר")).toBe("רעננה");
    expect(cityForNeighborhood("תלפיות")).toBe("ירושלים");
    expect(cityForNeighborhood("חוצות המפרץ")).toBe("חיפה");
  });

  it("returns null for text carrying no known neighborhood", () => {
    expect(cityForNeighborhood("")).toBeNull();
    expect(cityForNeighborhood("רחוב ללא שם")).toBeNull();
  });

  it("matches on whole tokens only", () => {
    // "הדר" must not fire inside a longer unrelated word.
    expect(cityForNeighborhood("הדרכה")).toBeNull();
  });
});

describe("extractCityFromLocation locality-before-neighborhood precedence", () => {
  it("prefers a real locality named in the string over any neighborhood", () => {
    // Both passes could match here; the locality pass must win.
    expect(extractCityFromLocation("נווה עמל, הרצליה")).toBe("הרצליה");
    expect(extractCityFromLocation("הדר, חיפה")).toBe("חיפה");
  });

  it("never lets a street-like neighborhood pull an address to another city", () => {
    // The regression this ordering exists to prevent: a long neighborhood phrase
    // outranking a short city name and rewriting the city.
    expect(extractCityFromLocation("רחוב אחד העם 5, ירושלים")).toBe("ירושלים");
    expect(extractCityFromLocation("רחוב אחד העם, חיפה")).toBe("חיפה");
  });

  it("falls back to the neighborhood only when no locality is present", () => {
    expect(extractCityFromLocation("נווה עמל")).toBe("הרצליה");
    expect(extractCityFromLocation("סגולה")).toBe("פתח תקווה");
  });
});

describe("localityFromStoreName over the expanded gazetteer", () => {
  it("recovers the locality for the city-less chains' real branch names", () => {
    // Sampled from the actual feed rows for Yohananof / Keshet Taamim / Salach
    // Dabach, the three chains that publish an empty <City>.
    const cases: Array<[string, string]> = [
      ["רמת השרון", "רמת השרון"],
      ["רעננה", "רעננה"],
      ["חולון המרכבה", "חולון"],
      ["ירושלים תלפיות", "ירושלים"],
      ["גן יבנה", "גן יבנה"],
      ["בילו", "קריית עקרון"],
      ["עקרון", "קריית עקרון"],
      ["הדר", "חיפה"],
      ["קרית אליעזר", "חיפה"],
      ["צק פוסט", "חיפה"],
      ["פולג", "נתניה"],
      ["ראשלצ רמת אליהו", "ראשון לציון"],
      ["ת\"א - אחד העם", "תל אביב-יפו"],
      ["סגולה פתח תקווה", "פתח תקווה"],
      ["יוקנעם", "יקנעם עילית"],
      ["מישור אדומים", "מעלה אדומים"],
      ["אור עקיבא -שקמים", "אור עקיבא"],
    ];
    for (const [name, expected] of cases) {
      expect(localityFromStoreName(name), name).toBe(expected);
      expect(centroidForCity(localityFromStoreName(name)), `${name} centroid`).not.toBeNull();
    }
  });

  it("leaves genuinely ambiguous or placeholder names unresolved", () => {
    // "אחד העם" is a street in dozens of towns and placeholder names carry no
    // locality at all. Guessing here would produce confidently wrong distances.
    for (const name of ["אחד העם", "Store 799", "יוחננוף ישן", "סופר דבאח מול"]) {
      expect(localityFromStoreName(name), name).toBeNull();
    }
  });
});
