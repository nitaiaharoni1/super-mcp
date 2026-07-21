import { describe, expect, it } from "vitest";
import { assertAllowedFeedUrl } from "../../../src/sources/common/allowedFetch.js";

describe("assertAllowedFeedUrl", () => {
  const allowed = ["prices.shufersal.co.il", "pricesprodpublic.blob.core.windows.net"];

  it("accepts an allowlisted https host", () => {
    const url = assertAllowedFeedUrl("https://prices.shufersal.co.il/FileObject/x", allowed);
    expect(url.hostname).toBe("prices.shufersal.co.il");
  });

  it("accepts a subdomain of an allowlisted host", () => {
    const url = assertAllowedFeedUrl("https://cdn.prices.shufersal.co.il/x", allowed);
    expect(url.hostname).toBe("cdn.prices.shufersal.co.il");
  });

  it("rejects a disallowed host", () => {
    expect(() => assertAllowedFeedUrl("https://evil.example/steal", allowed)).toThrow(
      /disallowed host/,
    );
  });

  it("rejects non-http schemes", () => {
    expect(() => assertAllowedFeedUrl("file:///etc/passwd", allowed)).toThrow(/non-http/);
  });
});
