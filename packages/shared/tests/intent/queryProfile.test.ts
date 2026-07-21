import { describe, expect, it } from "vitest";
import { heRetailOntologyFixture } from "../../test-utils/heRetailOntology.js";
import { buildQueryProfile } from "../../src/intent/queryProfile.js";

describe("buildQueryProfile", () => {
  const ontology = heRetailOntologyFixture();

  function profileFor(
    query: string,
    amount: number | null,
    unit: string | null,
  ) {
    return buildQueryProfile(query, ontology, { amount, unit });
  }

  it("implies form=fresh for bare produce concept מלפפונים", () => {
    const p = buildQueryProfile("מלפפונים", ontology);
    expect(p.attributes.form).toBe("fresh");
    expect(p.attributes.product_class ?? p.category).toBeTruthy();
  });

  it("does not invent form when query already has pickled cue", () => {
    const p = buildQueryProfile("מלפפונים כבושים", ontology);
    expect(p.attributes.form).toBe("pickled");
  });

  it("keeps cut/species for פרגיות", () => {
    const p = buildQueryProfile("פרגיות", ontology);
    expect(p.attributes.cut).toBe("thighs");
  });

  it("derives form=fresh from weighted produce amount+unit", () => {
    expect(profileFor("עגבניות", 1, "kg").attributes.form).toBe("fresh");
    expect(profileFor("תפוחי אדמה", 2, "kg").attributes.form).toBe("fresh");
  });

  it("does not infer fresh for preserved or flour produce queries even with kg", () => {
    expect(profileFor("עגבניות מרוסקות 1 ק״ג", 1, "kg").attributes.form).not.toBe("fresh");
    expect(profileFor("קמח תפוחי אדמה 1 ק״ג", 1, "kg").attributes.form).not.toBe("fresh");
  });

  it("promotes explicit pack count and volume from the query text", () => {
    expect(profileFor("ביצים תבנית 12", null, null).attributes.piece_count).toBe("12");
    expect(profileFor("שמן 1 ליטר", null, null).requestedAmount).toEqual({
      quantity: 1,
      unit: "L",
    });
  });
});
