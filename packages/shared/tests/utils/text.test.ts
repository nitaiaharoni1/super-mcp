import { describe, expect, it } from "vitest";
import { escapeIlike, scrubNullChars, scrubOptionalText } from "../../src/utils/text.js";

describe("scrubNullChars", () => {
  it("removes NUL bytes", () => {
    expect(scrubNullChars("a\u0000b")).toBe("ab");
  });
});

describe("scrubOptionalText", () => {
  it("returns undefined for empty after trim", () => {
    expect(scrubOptionalText("  \u0000  ")).toBeUndefined();
  });

  it("returns cleaned text", () => {
    expect(scrubOptionalText("  hello\u0000  ")).toBe("hello");
  });
});

describe("escapeIlike", () => {
  it("escapes wildcards and backslashes", () => {
    expect(escapeIlike("100%_\\")).toBe("100\\%\\_\\\\");
  });
});
