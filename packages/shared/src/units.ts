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
  gram: { unit: "g", factorToCanonical: 1 },
  grams: { unit: "g", factorToCanonical: 1 },
  kg: { unit: "g", factorToCanonical: 1000 },
  קג: { unit: "g", factorToCanonical: 1000 },
  "ק\"ג": { unit: "g", factorToCanonical: 1000 },
  קילו: { unit: "g", factorToCanonical: 1000 },
  ml: { unit: "ml", factorToCanonical: 1 },
  מל: { unit: "ml", factorToCanonical: 1 },
  "מ\"ל": { unit: "ml", factorToCanonical: 1 },
  l: { unit: "ml", factorToCanonical: 1000 },
  ליטר: { unit: "ml", factorToCanonical: 1000 },
  lit: { unit: "ml", factorToCanonical: 1000 },
  liter: { unit: "ml", factorToCanonical: 1000 },
  litre: { unit: "ml", factorToCanonical: 1000 },
  unit: { unit: "unit", factorToCanonical: 1 },
  יחידה: { unit: "unit", factorToCanonical: 1 },
  יח: { unit: "unit", factorToCanonical: 1 },
  "יח'": { unit: "unit", factorToCanonical: 1 },
  units: { unit: "unit", factorToCanonical: 1 },
  pcs: { unit: "unit", factorToCanonical: 1 },
};

function cleanUnit(raw?: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "");
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
  // Israeli feeds: ItemType 1 usually means barcode/GTIN.
  // Also accept 8/12/13/14 digit codes when type is ambiguous.
  const digits = itemCode.replace(/\D/g, "");
  if (itemType === 1 && digits.length >= 8 && digits.length <= 14) return true;
  if ((itemType === 0 || itemType === 1) && (digits.length === 13 || digits.length === 12 || digits.length === 8)) {
    return true;
  }
  return false;
}

export function normalizeGtin(itemCode: string): string {
  return itemCode.replace(/\D/g, "");
}
