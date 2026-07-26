/**
 * Asking for "1 kg of ground beef" is not asking for a pack size.
 *
 * `packSizesCompatible` gates peers on how close their PACK is to the primary's,
 * within 15%. That is right when the shopper asked for packs ("3 of these"),
 * because the size is part of the request. It is meaningless when they asked for
 * an AMOUNT: a kilo is a kilo whether it arrives as two 500 g trays or a kilo off
 * the butcher's scale.
 *
 * Measured at Tiv Taam Eden Gan Ha'ir, both stocked, both refreshed that day:
 *
 *   בשר טחון בלדי טהור 500 גר    ₪44.90 / 500 g   = ₪89.80 per kg
 *   בשר טחון טרי לקבב/המבורגר    ₪63.90 / kg      = ₪63.90 per kg
 *
 * packSizesCompatible(500 g, 1000 g) returns `qty_tolerance`, so the counter cut
 * never became a peer and was never price-compared. The shopper was quoted the
 * tray and paid ₪26 more for the same kilo.
 */
import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_OVERSHOOT, packComposesAmount } from "../../src/utils/units.js";

const want1kg = { amount: 1, unit: "kg" };

describe("composing a requested amount out of whole packs", () => {
  it("admits the pack sizes that build a kilo exactly", () => {
    expect(packComposesAmount({ sizeQty: 500, sizeUnit: "g" }, want1kg)).toBe(true);
    expect(packComposesAmount({ sizeQty: 1000, sizeUnit: "g" }, want1kg)).toBe(true);
    expect(packComposesAmount({ sizeQty: 250, sizeUnit: "g" }, want1kg)).toBe(true);
  });

  it("rejects a pack so large that buying one massively overshoots", () => {
    // A 5kg catering pack satisfies "1 kg" only by sending someone home with 5kg.
    expect(packComposesAmount({ sizeQty: 5000, sizeUnit: "g" }, want1kg)).toBe(false);
    expect(packComposesAmount({ sizeQty: 2000, sizeUnit: "g" }, want1kg)).toBe(false);
  });

  it("tolerates a modest overshoot, since whole packs rarely divide evenly", () => {
    // 3 x 400g = 1.2kg, 20% over. You cannot buy two and a half trays.
    expect(packComposesAmount({ sizeQty: 400, sizeUnit: "g" }, want1kg)).toBe(true);
    // 2 x 700g = 1.4kg, 40% over. That is a different shop.
    expect(packComposesAmount({ sizeQty: 700, sizeUnit: "g" }, want1kg)).toBe(false);
  });

  it("never crosses measure families", () => {
    expect(packComposesAmount({ sizeQty: 1000, sizeUnit: "ml" }, want1kg)).toBe(false);
    expect(packComposesAmount({ sizeQty: 1, sizeUnit: "unit" }, want1kg)).toBe(false);
  });

  it("says no when either side cannot be parsed, rather than guessing", () => {
    expect(packComposesAmount({ sizeQty: null, sizeUnit: "g" }, want1kg)).toBe(false);
    expect(packComposesAmount({ sizeQty: 500, sizeUnit: null }, want1kg)).toBe(false);
    expect(packComposesAmount({ sizeQty: 500, sizeUnit: "g" }, { amount: 1, unit: "" })).toBe(false);
    expect(packComposesAmount({ sizeQty: 500, sizeUnit: "g" }, { amount: 0, unit: "kg" })).toBe(
      false,
    );
  });

  it("handles litres and millilitres the same way", () => {
    const want2L = { amount: 2, unit: "L" };
    expect(packComposesAmount({ sizeQty: 1000, sizeUnit: "ml" }, want2L)).toBe(true);
    expect(packComposesAmount({ sizeQty: 500, sizeUnit: "ml" }, want2L)).toBe(true);
    expect(packComposesAmount({ sizeQty: 5000, sizeUnit: "ml" }, want2L)).toBe(false);
  });

  it("honours a caller-supplied overshoot bound", () => {
    // 2 x 700g against 1kg is 40% over: allowed at 0.5, refused at the default.
    expect(packComposesAmount({ sizeQty: 700, sizeUnit: "g" }, want1kg, 0.5)).toBe(true);
    expect(MAX_AMOUNT_OVERSHOOT).toBeLessThan(0.4);
  });
});
