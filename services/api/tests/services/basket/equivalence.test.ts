import { describe, expect, it } from "vitest";
import { buildEquivalenceSet } from "../../../src/services/basket/equivalence.js";
import type { BasketCandidate } from "../../../src/services/basket/types.js";

const cand = (over: Partial<BasketCandidate>): BasketCandidate => ({
  productId: crypto.randomUUID(),
  name: "עגבניות חממה",
  score: 0.9,
  matchedVia: "product",
  sizeQty: null,
  sizeUnit: "kg",
  hasPrice: true,
  hasLocalPrice: true,
  productClass: "produce_tomato",
  intentTier: 1,
  ...over,
});

describe("buildEquivalenceSet", () => {
  it("keeps gate-passing same-class, unit-compatible candidates", () => {
    const top = cand({});
    const set = buildEquivalenceSet(
      top,
      [
        top,
        cand({ name: 'עגבניה תמ"י' }),
        cand({ name: "רסק עגבניות", productClass: "canned_tomato" }), // class mismatch: out
        cand({ name: "עגבניות שרי 250 גרם", sizeQty: 0.25, sizeUnit: "kg", intentTier: 3 }), // gate fail: out
      ],
      { packTolerance: 0.5, maxEquivalents: 5 },
    );
    expect(set.map((c) => c.name)).toEqual(["עגבניות חממה", 'עגבניה תמ"י']);
  });

  it("returns only the top pick when it has no class (unclassified lines never widen)", () => {
    const top = cand({ productClass: null });
    const set = buildEquivalenceSet(top, [top, cand({ productClass: null })], {
      packTolerance: 0.5,
      maxEquivalents: 5,
    });
    expect(set).toHaveLength(1);
  });

  it("excludes a same-class candidate whose pack size diverges beyond tolerance", () => {
    const top = cand({ sizeQty: 1, sizeUnit: "kg" });
    const set = buildEquivalenceSet(
      top,
      [
        top,
        cand({ name: "within-tolerance", sizeQty: 1.4, sizeUnit: "kg" }), // +40% <= 50%: in
        cand({ name: "beyond-tolerance", sizeQty: 2, sizeUnit: "kg" }), // +100% > 50%: out
      ],
      { packTolerance: 0.5, maxEquivalents: 5 },
    );
    expect(set.map((c) => c.name)).toEqual(["עגבניות חממה", "within-tolerance"]);
  });
});
