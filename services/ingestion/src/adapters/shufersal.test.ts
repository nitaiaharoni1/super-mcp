import { describe, expect, it } from "vitest";
import { extractFeedHrefs } from "./shufersal.js";

describe("extractFeedHrefs", () => {
  it("extracts hrefs pointing at xml/gz feed files", () => {
    const html = `<a href="/prices/PriceFull7290027600007-001-202607170300.xml.gz">download</a>`;
    expect([...extractFeedHrefs(html)]).toContain(
      "/prices/PriceFull7290027600007-001-202607170300.xml.gz",
    );
  });

  it("extracts absolute URLs even when they contain the letter 's' (regex regression)", () => {
    // Not an href attribute, so only the absolute-URL pattern can catch it.
    const url =
      "https://pricesprod.blob.core.windows.net/PriceFull7290027600007-001-202607170300.xml.gz";
    const html = `<script>window.open('${url}')</script>`;
    expect([...extractFeedHrefs(html)]).toContain(url);
  });
});
