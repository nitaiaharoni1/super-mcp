import { describe, expect, it } from "vitest";
import { extractFeedHrefs, parseStoreDropdown } from "../../../src/sources/shufersal/index.js";

describe("extractFeedHrefs", () => {
  it("extracts hrefs pointing at xml/gz feed files", () => {
    const html = `<a href="/prices/PriceFull7290027600007-001-202607170300.xml.gz">download</a>`;
    expect([...extractFeedHrefs(html)]).toContain(
      "/prices/PriceFull7290027600007-001-202607170300.xml.gz",
    );
  });

  it("extracts Azure blob SAS URLs (current Shufersal portal)", () => {
    const url =
      "https://pricesprodpublic.blob.core.windows.net/price/PriceFull7290027600007-001-001-20260716-030000.gz?sv=2014-02-14&amp;sr=b&amp;sig=abc%3D&amp;se=2026-07-16T23%3A37%3A31Z&amp;sp=r";
    const html = `<td><a href="${url}" target="_blank">Download</a></td>`;
    const hrefs = [...extractFeedHrefs(html)];
    expect(hrefs.some((h) => h.includes("PriceFull7290027600007-001-001") && h.includes("sig=abc"))).toBe(
      true,
    );
    expect(hrefs[0]).not.toContain("&amp;");
  });

  it("extracts absolute URLs even when they contain the letter 's' (regex regression)", () => {
    const url =
      "https://pricesprod.blob.core.windows.net/PriceFull7290027600007-001-202607170300.xml.gz";
    const html = `<script>window.open('${url}')</script>`;
    expect([...extractFeedHrefs(html)]).toContain(url);
  });
});

describe("parseStoreDropdown", () => {
  it("parses store options with Hebrew labels", () => {
    const html = `<select id="ddlStore"><option value="0">All</option>
<option value="1">1 - שלי ת&quot;א- בן יהודה</option>
<option value="4">4 - שלי חיפה- כרמל</option></select>`;
    const stores = parseStoreDropdown(html);
    expect(stores).toHaveLength(2);
    expect(stores[0]?.storeId).toBe("1");
    expect(stores[0]?.name).toContain("בן יהודה");
    expect(stores[1]?.storeId).toBe("4");
  });
});
