import { describe, expect, it } from "vitest";
import { parsePublishPriceHtml } from "./publishprice.js";

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
