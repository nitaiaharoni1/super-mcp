/**
 * Hebrew writes many words with and without the optional yod/vav, and the price
 * feeds are inconsistent even inside one chain. Folding those letters lets one
 * spelling match the other; the length guard stops it going too far.
 */
import { describe, expect, it } from "vitest";
import { foldMatresLectionis } from "../../src/intent/hebrewMorphology.js";

describe("foldMatresLectionis", () => {
  it("makes ktiv male and ktiv haser agree", () => {
    expect(foldMatresLectionis("קורנפלייקס")).toBe(foldMatresLectionis("קורנפלקס"));
    expect(foldMatresLectionis("שוקולד")).toBe(foldMatresLectionis("שקולד"));
  });

  it("leaves short words untouched, where those letters carry meaning", () => {
    // שמן (oil) and שומן (fat) are different products.
    expect(foldMatresLectionis("שמן")).toBe("שמן");
    expect(foldMatresLectionis("שומן")).not.toBe(foldMatresLectionis("שמן"));
    expect(foldMatresLectionis("יין")).toBe("יין");
  });

  it("keeps a word that is mostly vowels rather than folding it to a stub", () => {
    // Folding אוויר down to two letters would start matching unrelated words.
    expect(foldMatresLectionis("אוויר").length).toBeGreaterThanOrEqual(3);
  });

  it("is a no-op on words with no optional letters to drop", () => {
    expect(foldMatresLectionis("פסטה")).toBe("פסטה");
    expect(foldMatresLectionis("")).toBe("");
  });

  it("folds both sides consistently, which is the property comparisons rely on", () => {
    // The point is not that a word is left untouched; גבינה legitimately folds to
    // גבנה. The point is that the same input always yields the same output, so a
    // query and a product name reduce to the same key.
    expect(foldMatresLectionis("גבינה")).toBe(foldMatresLectionis("גבינה"));
    expect(foldMatresLectionis("גבינה")).toBe(foldMatresLectionis("גבנה"));
  });
});
