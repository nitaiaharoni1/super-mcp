import { describe, expect, it } from "vitest";
import { heRetailOntologyFixture } from "../../test-utils/heRetailOntology.js";
import { buildQueryProfile } from "../../src/intent/queryProfile.js";

describe("buildQueryProfile", () => {
  const ontology = heRetailOntologyFixture();

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
});
