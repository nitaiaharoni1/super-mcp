import { describe, expect, it } from "vitest";
import {
  jerusalemDateKeys,
  mergePublishPriceDayFiles,
  parsePublishPriceHtml,
} from "../../../src/sources/publishprice/index.js";

describe("parsePublishPriceHtml", () => {
  it("extracts path and files from Carrefour-style HTML", () => {
    const html = `
      <script>
        const path = '20260717';
        const files = [{"name":"Stores7290055700007-000-20260717-000100.xml","size":61762},{"name":"PriceFull7290055700007-001-416-20260717-000012.gz","size":100}];
      </script>
    `;
    const page = parsePublishPriceHtml(html);
    expect(page.path).toBe("20260717");
    expect(page.files).toHaveLength(2);
    expect(page.files[0]?.name).toContain("Stores");
  });

  it("throws when path is missing", () => {
    expect(() => parsePublishPriceHtml("<html></html>")).toThrow(/missing const path/);
  });
});

describe("jerusalemDateKeys", () => {
  it("returns YYYYMMDD newest-first for lookback", () => {
    // 22:00 UTC on Jul 16 = Jul 17 01:00 in Israel (summer) → today is 20260717
    const keys = jerusalemDateKeys(3, new Date("2026-07-16T22:00:00.000Z"));
    expect(keys).toEqual(["20260717", "20260716", "20260715"]);
  });

  it("steps civil days across month boundaries", () => {
    // Israel local 2026-03-01 10:00 → keys start at March 1
    const keys = jerusalemDateKeys(3, new Date("2026-03-01T08:00:00.000Z"));
    expect(keys).toEqual(["20260301", "20260228", "20260227"]);
  });
});

describe("mergePublishPriceDayFiles", () => {
  it("prefers newer day for the same store PriceFull", () => {
    const merged = mergePublishPriceDayFiles([
      {
        dayPath: "20260716",
        name: "PriceFull7290055700007-001-009-20260716-120000.gz",
      },
      {
        dayPath: "20260717",
        name: "PriceFull7290055700007-001-009-20260717-000012.gz",
      },
      {
        dayPath: "20260716",
        name: "Stores7290055700007-000-20260716-000100.xml",
      },
      {
        dayPath: "20260717",
        name: "PriceFull7290055700007-001-089-20260716-080000.gz",
      },
    ]);
    const names = merged.map((f) => f.name);
    expect(names).toContain("PriceFull7290055700007-001-009-20260717-000012.gz");
    expect(names).not.toContain("PriceFull7290055700007-001-009-20260716-120000.gz");
    expect(names).toContain("PriceFull7290055700007-001-089-20260716-080000.gz");
    expect(names.filter((n) => n.startsWith("Stores"))).toHaveLength(1);
  });

  it("skips non-Full Price/Promo dumps", () => {
    const merged = mergePublishPriceDayFiles([
      { dayPath: "20260716", name: "Price7290055700007-001-009-20260716-120000.gz" },
      {
        dayPath: "20260716",
        name: "PriceFull7290055700007-001-009-20260716-120000.gz",
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toContain("PriceFull");
  });
});
