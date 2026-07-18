/** Normalize qty+unit and recompute price-per-100g/100ml/unit. */

export type CanonicalUnit = "g" | "ml" | "unit";

export interface NormalizedMeasure {
  quantity: number;
  unit: CanonicalUnit;
  /** True when qty/unit could not be parsed reliably. */
  unparseable: boolean;
  originalQty?: number;
  originalUnit?: string;
}

export interface UnitPriceResult {
  measure: NormalizedMeasure;
  /** Price per 100g, 100ml, or per unit. Null if unparseable. */
  pricePerCanonical: number | null;
}

const UNIT_ALIASES: Record<string, { unit: CanonicalUnit; factorToCanonical: number }> = {
  g: { unit: "g", factorToCanonical: 1 },
  גרם: { unit: "g", factorToCanonical: 1 },
  גרמים: { unit: "g", factorToCanonical: 1 },
  gram: { unit: "g", factorToCanonical: 1 },
  grams: { unit: "g", factorToCanonical: 1 },
  kg: { unit: "g", factorToCanonical: 1000 },
  קג: { unit: "g", factorToCanonical: 1000 },
  "ק\"ג": { unit: "g", factorToCanonical: 1000 },
  קילו: { unit: "g", factorToCanonical: 1000 },
  קילוגרם: { unit: "g", factorToCanonical: 1000 },
  קילוגרמים: { unit: "g", factorToCanonical: 1000 },
  "ק'ג": { unit: "g", factorToCanonical: 1000 },
  ml: { unit: "ml", factorToCanonical: 1 },
  מל: { unit: "ml", factorToCanonical: 1 },
  "מ\"ל": { unit: "ml", factorToCanonical: 1 },
  "מ'ל": { unit: "ml", factorToCanonical: 1 },
  מיליליטר: { unit: "ml", factorToCanonical: 1 },
  מיליליטרים: { unit: "ml", factorToCanonical: 1 },
  l: { unit: "ml", factorToCanonical: 1000 },
  ליטר: { unit: "ml", factorToCanonical: 1000 },
  ליטרים: { unit: "ml", factorToCanonical: 1000 },
  lit: { unit: "ml", factorToCanonical: 1000 },
  liter: { unit: "ml", factorToCanonical: 1000 },
  litre: { unit: "ml", factorToCanonical: 1000 },
  unit: { unit: "unit", factorToCanonical: 1 },
  יחידה: { unit: "unit", factorToCanonical: 1 },
  יחידות: { unit: "unit", factorToCanonical: 1 },
  פריט: { unit: "unit", factorToCanonical: 1 },
  יח: { unit: "unit", factorToCanonical: 1 },
  "יח'": { unit: "unit", factorToCanonical: 1 },
  units: { unit: "unit", factorToCanonical: 1 },
  pcs: { unit: "unit", factorToCanonical: 1 },
};

function cleanUnit(raw?: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    // Normalize Hebrew punctuation to ASCII so feed spellings match the alias
    // table: geresh(U+05F3)/prime→', gershayim(U+05F4)/double-prime→".
    .replace(/[׳′]/g, "'")
    .replace(/[״″]/g, '"')
    .replace(/\s+/g, "")
    // Strip dots that are NOT decimal separators (e.g. trailing "יח.") but keep
    // digit-internal dots so embedded quantities like "1.5ל" stay 1.5, not 15.
    .replace(/(?<!\d)\.|\.(?!\d)/g, "");
}

export function normalizeMeasure(
  qty?: number,
  unit?: string,
  isWeighted?: boolean,
): NormalizedMeasure {
  const originalQty = qty;
  const originalUnit = unit;
  const cleaned = cleanUnit(unit);

  if (qty == null || !Number.isFinite(qty) || qty <= 0) {
    if (isWeighted) {
      return {
        quantity: 1000,
        unit: "g",
        unparseable: false,
        originalQty,
        originalUnit,
      };
    }
    return {
      quantity: 1,
      unit: "unit",
      unparseable: true,
      originalQty,
      originalUnit,
    };
  }

  const mapped = UNIT_ALIASES[cleaned];
  if (!mapped) {
    // Try embedded patterns like "500ג" / "1.5ליטר"
    const embedded = cleaned.match(/^([\d.]+)(.+)$/);
    if (embedded) {
      const n = Number(embedded[1]);
      const u = UNIT_ALIASES[cleanUnit(embedded[2])];
      if (u && Number.isFinite(n) && n > 0) {
        return {
          quantity: n * u.factorToCanonical,
          unit: u.unit,
          unparseable: false,
          originalQty,
          originalUnit,
        };
      }
    }
    return {
      quantity: qty,
      unit: "unit",
      unparseable: true,
      originalQty,
      originalUnit,
    };
  }

  return {
    quantity: qty * mapped.factorToCanonical,
    unit: mapped.unit,
    unparseable: false,
    originalQty,
    originalUnit,
  };
}

/**
 * Infer package size from common Hebrew/English name patterns when size fields are missing.
 * Examples: "פיתות 10יח", "מארז 10 פיתות", "6 * 1.5 ליטר", "750 גרם".
 */
export function inferPackSizeFromName(
  name: string | null | undefined,
): { quantity: number; unit: string } | null {
  if (!name) return null;
  const n = name.replace(/\s+/g, " ").trim();

  // Multipack "N × size unit" — shelf price is for the whole pack, so return total contents.
  // e.g. "6 * 1.5 ליטר" → 9L, "10×100ג" → 1000g.
  const multipackSize = n.match(
    /(\d+(?:\.\d+)?)\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(גרם|גר['׳]|g|ק["״]?ג|קילו|kg|מ["״]?ל|ml|ליטר|l)(?=$|[\s,.\-_/])/i,
  );
  if (multipackSize) {
    const left = Number(multipackSize[1]);
    const right = Number(multipackSize[2]);
    const u = multipackSize[3]!;
    if (Number.isFinite(left) && left > 0 && Number.isFinite(right) && right > 0) {
      return { quantity: left * right, unit: u };
    }
  }

  // "מארז 10 פיתות" / "10 יח"
  const packUnits =
    n.match(/מארז\s*(\d+(?:\.\d+)?)/i) ||
    n.match(/(\d+(?:\.\d+)?)\s*(?:יחידות|יח['׳]?|units?|pcs)(?=$|[\s,.\-_/])/i);
  if (packUnits) {
    const q = Number(packUnits[1]);
    if (Number.isFinite(q) && q > 0) return { quantity: q, unit: "unit" };
  }

  const grams = n.match(/(\d+(?:\.\d+)?)\s*(?:גרם|גר['׳]|g)(?=$|[\s,.\-_/])/i);
  if (grams) {
    const q = Number(grams[1]);
    if (Number.isFinite(q) && q > 0) return { quantity: q, unit: "g" };
  }

  const kg = n.match(/(\d+(?:\.\d+)?)\s*(?:ק["״]?ג|קילו|kg)(?=$|[\s,.\-_/])/i);
  if (kg) {
    const q = Number(kg[1]);
    if (Number.isFinite(q) && q > 0) return { quantity: q, unit: "kg" };
  }

  const ml = n.match(/(\d+(?:\.\d+)?)\s*(?:מ["״]?ל|ml)(?=$|[\s,.\-_/])/i);
  if (ml) {
    const q = Number(ml[1]);
    if (Number.isFinite(q) && q > 0) return { quantity: q, unit: "ml" };
  }

  const liter = n.match(/(\d+(?:\.\d+)?)\s*(?:ליטר|l)(?=$|[\s,.\-_/])/i);
  if (liter) {
    const q = Number(liter[1]);
    if (Number.isFinite(q) && q > 0) return { quantity: q, unit: "l" };
  }

  return null;
}

/**
 * Convert a requested shopping amount into a purchase quantity for basket math.
 *
 * - Packaged goods with known size: number of packs (ceil).
 * - Weighted / unknown size: shelf qty in kg or L (feeds price per kg/L) or unit count.
 * - If only `packQty` is provided (legacy), that pack count is returned unchanged.
 */
export function resolvePurchaseQty(input: {
  /** Legacy pack count when amount/unit are omitted. */
  packQty?: number;
  amount?: number;
  unit?: string;
  productSizeQty?: number | null;
  productSizeUnit?: string | null;
  /** Used to infer pack size from name when size fields are missing. */
  productName?: string | null;
}): { qty: number; mode: "packs" | "weighted_kg_or_l" | "units" | "legacy_packs" } {
  const { amount, unit, packQty, productSizeQty, productSizeUnit } = input;

  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    const q = packQty != null && Number.isFinite(packQty) && packQty > 0 ? packQty : 1;
    return { qty: q, mode: "legacy_packs" };
  }

  const need = normalizeMeasure(amount, unit);
  if (need.unparseable) {
    const q = packQty != null && Number.isFinite(packQty) && packQty > 0 ? packQty : amount;
    return { qty: q, mode: "legacy_packs" };
  }

  const dbPack =
    productSizeQty != null && productSizeUnit
      ? normalizeMeasure(productSizeQty, productSizeUnit)
      : null;
  const inferred = inferPackSizeFromName(input.productName);
  const inferredPack = inferred ? normalizeMeasure(inferred.quantity, inferred.unit) : null;
  const sizeConflict =
    dbPack &&
    inferredPack &&
    !dbPack.unparseable &&
    !inferredPack.unparseable &&
    dbPack.unit === inferredPack.unit &&
    dbPack.quantity > 1 &&
    inferredPack.quantity > 1 &&
    Math.abs(dbPack.quantity - inferredPack.quantity) / inferredPack.quantity > 0.1;

  // Counted items (יח): prefer name/"N יח" pack counts even when DB size is weight (e.g. 480g).
  if (need.unit === "unit") {
    const unitPack =
      inferredPack && !inferredPack.unparseable && inferredPack.unit === "unit" && inferredPack.quantity > 1
        ? inferredPack
        : dbPack && !dbPack.unparseable && dbPack.unit === "unit" && dbPack.quantity > 1
          ? dbPack
          : null;
    if (unitPack) {
      return {
        qty: Math.max(1, Math.ceil(need.quantity / unitPack.quantity)),
        mode: "packs",
      };
    }
    return { qty: need.quantity, mode: "units" };
  }

  // Explicit size in the product name is more trustworthy when DB metadata materially conflicts.
  let pack = sizeConflict ? inferredPack : dbPack;
  if (
    inferredPack &&
    !inferredPack.unparseable &&
    (!pack ||
      pack.unparseable ||
      (pack.unit === "unit" && pack.quantity === 1 && inferredPack.quantity > 1))
  ) {
    pack = inferredPack;
  }

  if (pack && !pack.unparseable && pack.unit === need.unit && pack.quantity > 1) {
    // quantity<=1 g/ml stubs explode pack counts; real small packs (e.g. 40g) are fine.
    return {
      qty: Math.max(1, Math.ceil(need.quantity / pack.quantity)),
      mode: "packs",
    };
  }

  // Israeli weighted produce/meat shelves are typically ₪/kg or ₪/L.
  return { qty: need.quantity / 1000, mode: "weighted_kg_or_l" };
}

export function computeUnitPrice(
  price: number,
  qty?: number,
  unit?: string,
  isWeighted?: boolean,
): UnitPriceResult {
  const measure = normalizeMeasure(qty, unit, isWeighted);
  if (measure.unparseable || !Number.isFinite(price) || price < 0) {
    return { measure, pricePerCanonical: null };
  }
  if (measure.quantity <= 0) {
    return { measure: { ...measure, unparseable: true }, pricePerCanonical: null };
  }

  if (measure.unit === "unit") {
    return { measure, pricePerCanonical: price / measure.quantity };
  }

  // price per 100g or 100ml
  return {
    measure,
    pricePerCanonical: (price / measure.quantity) * 100,
  };
}

export function isGtinItem(itemType: number, itemCode: string): boolean {
  // Only ItemType 1 (ברקוד) carries a real barcode. ItemType 0 (פנימי) is a
  // chain-internal code by the Israeli price-feed spec — never cross-chain
  // product identity.
  if (itemType !== 1) return false;
  const digits = itemCode.replace(/\D/g, "");
  const isValidLen = (n: number) => n === 8 || n === 12 || n === 13 || n === 14;
  // Accept a raw valid GTIN length as-is (a UPC-A may legitimately start with a
  // zero, so don't strip first); only for over-padded codes fall back to the
  // leading-zero-stripped length. Reject 9/10/11-digit codes — they aren't
  // GTINs and were merging unrelated items across chains.
  const stripped = digits.replace(/^0+/, "");
  const len = isValidLen(digits.length) ? digits.length : stripped.length;
  if (!isValidLen(len)) return false;
  // GS1 prefix 2 (in-store number system / 02x range) is a Restricted
  // Circulation Number: variable-weight, chain-local, never globally unique.
  if (/^2/.test(stripped)) return false;
  return true;
}

export function normalizeGtin(itemCode: string): string {
  const digits = itemCode.replace(/\D/g, "");
  // GS1 comparison ignores leading zeros (GTIN-14 is zero-padded; EAN-13 = 0 + UPC-A).
  // Keep degenerate short codes as-is so we never return an empty/ambiguous key.
  const stripped = digits.replace(/^0+/, "");
  return stripped.length >= 8 ? stripped : digits;
}

/** The item_code a listing row is keyed on: normalized GTIN for barcode items, raw code otherwise. */
export function canonicalItemCode(itemType: number, itemCode: string): string {
  return isGtinItem(itemType, itemCode) ? normalizeGtin(itemCode) : itemCode;
}
