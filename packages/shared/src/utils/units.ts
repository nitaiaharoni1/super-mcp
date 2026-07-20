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
 * Typical per-piece weight (kg) for produce commonly requested by count (e.g.
 * "4 לימונים"). Used when the matched product has no usable unit-pack and is
 * sold by weight (₪/kg), so a piece count must be converted to an approximate
 * kg quantity instead of being multiplied directly against a per-kg price.
 * Keys are matched as substrings of the normalized product name; when several
 * match, the longest (most specific) key wins.
 */
const PRODUCE_PIECE_WEIGHT_KG: Record<string, number> = {
  לימון: 0.12,
  עגבניה: 0.12,
  עגבניות: 0.12,
  מלפפון: 0.11,
  מלפפונים: 0.11,
  פלפל: 0.16,
  "בצל ירוק": 0.05,
  בצל: 0.15,
  תפוח: 0.18,
  תפוז: 0.2,
  שום: 0.05,
  גזר: 0.08,
  'תפו"א': 0.15,
  "תפוח אדמה": 0.15,
  בטטה: 0.2,
  קישוא: 0.15,
  חציל: 0.25,
  אבוקדו: 0.2,
  בננה: 0.15,
  בננות: 0.15,
  אגס: 0.2,
  אפרסק: 0.15,
  שזיף: 0.08,
  קיווי: 0.09,
  רימון: 0.3,
  אבטיח: 4.0,
  מלון: 1.5,
};

const DEFAULT_PIECE_WEIGHT_KG = 0.15;

/** Whole-token produce cues — never substring-match (פרי ⊂ פרימיום). */
const PRODUCE_NAME_CUE_TOKENS: ReadonlySet<string> = new Set([
  "ירק",
  "ירקות",
  "פירות",
  "פרי",
]);

/**
 * Estimate a typical per-piece weight (kg) for produce from its product name.
 * Returns null for non-produce / packaged goods so callers buy unit counts
 * instead of inventing a kg qty (wine 750ml must not become 0.15kg).
 */
function estimatePieceWeightKg(productName: string | null | undefined): number | null {
  const name = (productName ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;

  let bestToken = "";
  let bestWeight: number | null = null;
  for (const token of Object.keys(PRODUCE_PIECE_WEIGHT_KG)) {
    if (name.includes(token) && token.length > bestToken.length) {
      bestToken = token;
      bestWeight = PRODUCE_PIECE_WEIGHT_KG[token]!;
    }
  }
  if (bestWeight != null) return bestWeight;
  // Tokenize on whitespace / punctuation so "פרימיום" ≠ cue "פרי".
  const tokens = name.split(/[^\u0590-\u05FFa-zA-Z0-9"]+/).filter(Boolean);
  if (tokens.some((t) => PRODUCE_NAME_CUE_TOKENS.has(t))) return DEFAULT_PIECE_WEIGHT_KG;
  return null;
}

function listingSoldByWeight(
  isWeighted?: boolean,
  saleBasis?: string | null,
): boolean {
  if (isWeighted === true) return true;
  return saleBasis === "per_kg" || saleBasis === "per_l";
}

/**
 * Convert a requested shopping amount into a purchase quantity for basket math.
 *
 * - Packaged goods with known size: number of packs (ceil).
 * - Weighted / unknown size: shelf qty in kg or L (feeds price per kg/L) or unit count.
 * - If only `packQty` is provided and the listing is weighted (isWeighted /
 *   sale_basis per_kg|per_l): treat packQty as piece count for recognized produce
 *   (→ kg via piece-weight heuristics), otherwise as a kg/L amount.
 * - Otherwise packQty is returned unchanged as pack count (`mode: "packs"`).
 */
export interface PurchaseQuantityInput {
  /** Shelf pack count when amount/unit are omitted. */
  packQty?: number;
  amount?: number;
  unit?: string;
  productSizeQty?: number | null;
  productSizeUnit?: string | null;
  /** Used to infer pack size from name when size fields are missing. */
  productName?: string | null;
  /** Persisted number of pieces in one retail pack. */
  pieceCount?: number | null;
  /** Listing/product sold by weight (feed bIsWeighted or backfill). */
  isWeighted?: boolean;
  /** listing.sale_basis: per_kg | per_l | per_piece | per_pack | unknown */
  saleBasis?: string | null;
}

export interface PurchaseQuantity {
  qty: number;
  mode: "packs" | "weighted_kg_or_l" | "units";
}

export function resolvePurchaseQty(input: PurchaseQuantityInput): PurchaseQuantity {
  const { amount, unit, packQty, productSizeQty, productSizeUnit } = input;

  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    const q = packQty != null && Number.isFinite(packQty) && packQty > 0 ? packQty : 1;
    if (listingSoldByWeight(input.isWeighted, input.saleBasis)) {
      const pieceWeightKg = estimatePieceWeightKg(input.productName);
      if (pieceWeightKg != null) {
        const kg = Math.round(q * pieceWeightKg * 1000) / 1000;
        return { qty: kg, mode: "weighted_kg_or_l" };
      }
      // Non-produce weighted SKU: pack_qty means kg (or L) of product.
      return { qty: q, mode: "weighted_kg_or_l" };
    }
    return { qty: q, mode: "packs" };
  }

  const need = normalizeMeasure(amount, unit);
  if (need.unparseable) {
    const q = packQty != null && Number.isFinite(packQty) && packQty > 0 ? packQty : amount;
    return { qty: q, mode: "packs" };
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
    const inferredUnitPack =
      inferredPack && !inferredPack.unparseable && inferredPack.unit === "unit" && inferredPack.quantity > 1
        ? inferredPack.quantity
        : null;
    const persistedUnitPack =
      input.pieceCount != null && Number.isFinite(input.pieceCount) && input.pieceCount > 1
        ? input.pieceCount
        : null;
    const dbUnitPack =
      dbPack && !dbPack.unparseable && dbPack.unit === "unit" && dbPack.quantity > 1
        ? dbPack.quantity
        : null;
    const piecesPerPack = inferredUnitPack ?? persistedUnitPack ?? dbUnitPack;
    if (piecesPerPack != null) {
      return {
        qty: Math.max(1, Math.ceil(need.quantity / piecesPerPack)),
        mode: "packs",
      };
    }
    // No unit-pack: convert piece→kg ONLY for recognized produce. Packaged
    // g/ml retail SKUs (wine 750ml, hummus tubs) are sold per container — the
    // old "any g/ml ⇒ weighted" path undercounted bottles by ~6× via the
    // 0.15kg default piece weight.
    const pieceWeightKg = estimatePieceWeightKg(input.productName);
    if (pieceWeightKg != null) {
      // Round to grams-level precision so 3×0.15 does not become 0.44999999999999996.
      const kg = Math.round(need.quantity * pieceWeightKg * 1000) / 1000;
      return { qty: kg, mode: "weighted_kg_or_l" };
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

export type PackCompatOptions = {
  packTolerance?: number; // default 0.5
  /** When true, allow unit/count peers against g/ml weighted goods (produce). */
  allowCountToWeight?: boolean;
};

export type PackSizeInput = {
  sizeQty?: number | null;
  sizeUnit?: string | null;
  name?: string | null;
};

type ResolvedPack = {
  measure: NormalizedMeasure | null;
  /** Name inferred a multi-piece unit pack (e.g. "10 יח") even if DB says grams. */
  nameInfersUnitPack: boolean;
  /** True when sizeQty was absent and we only know the unit (stub qty=1). */
  qtyMissing: boolean;
};

/**
 * Reconcile a canonical g/ml measure against the product NAME. Feeds sometimes
 * deliver the name's quantity under the wrong family (a bottle named "1.5 ליטר"
 * stored as 1500 g). When the name parses to the SAME canonical quantity in the
 * OTHER g/ml family, the name is ground truth for the family.
 */
export function reconcileMeasureFamilyWithName(
  name: string | null | undefined,
  measure: NormalizedMeasure,
): NormalizedMeasure {
  const inferred = inferPackSizeFromName(name);
  const inferredPack = inferred ? normalizeMeasure(inferred.quantity, inferred.unit) : null;
  return flipFamilyIfNameConflicts(measure, inferredPack);
}

function flipFamilyIfNameConflicts(
  db: NormalizedMeasure,
  inferredPack: NormalizedMeasure | null,
): NormalizedMeasure {
  if (db.unparseable || (db.unit !== "g" && db.unit !== "ml")) return db;
  if (!inferredPack || inferredPack.unparseable) return db;
  if (inferredPack.unit !== "g" && inferredPack.unit !== "ml") return db;
  if (inferredPack.unit === db.unit) return db;
  if (inferredPack.quantity !== db.quantity) return db;
  return { ...db, unit: inferredPack.unit };
}

/**
 * Effective pack measure for equivalence: prefer parseable DB size; fall back to
 * name inference. A name-inferred unit pack (count>1) wins over a DB weight label
 * (multipack pita shelved as 1000g).
 */
function resolveEffectivePack(input: PackSizeInput): ResolvedPack {
  const inferred = inferPackSizeFromName(input.name);
  const inferredPack = inferred ? normalizeMeasure(inferred.quantity, inferred.unit) : null;
  const nameInfersUnitPack = Boolean(
    inferredPack &&
      !inferredPack.unparseable &&
      inferredPack.unit === "unit" &&
      inferredPack.quantity > 1,
  );
  if (nameInfersUnitPack) {
    return { measure: inferredPack, nameInfersUnitPack: true, qtyMissing: false };
  }

  const unit = input.sizeUnit?.trim();
  const qtyPresent =
    input.sizeQty != null && Number.isFinite(input.sizeQty) && input.sizeQty > 0;
  if (unit) {
    const db = normalizeMeasure(qtyPresent ? input.sizeQty! : 1, unit);
    if (!db.unparseable) {
      return {
        measure: flipFamilyIfNameConflicts(db, inferredPack),
        nameInfersUnitPack: false,
        qtyMissing: !qtyPresent,
      };
    }
  }

  if (inferredPack && !inferredPack.unparseable) {
    return {
      measure: inferredPack,
      nameInfersUnitPack: inferredPack.unit === "unit" && inferredPack.quantity > 1,
      qtyMissing: false,
    };
  }
  return { measure: null, nameInfersUnitPack: false, qtyMissing: true };
}

function isCountWeightPair(a: CanonicalUnit, b: CanonicalUnit): boolean {
  return (
    (a === "unit" && (b === "g" || b === "ml")) ||
    (b === "unit" && (a === "g" || a === "ml"))
  );
}

/**
 * Whether two SKU pack sizes are interchangeable for commodity equivalence /
 * coverage peer filtering. Canonicalizes kg↔g / יח↔unit and optionally allows
 * count↔weight for produce (or when a name implies a piece multipack).
 */
export function packSizesCompatible(
  a: PackSizeInput,
  b: PackSizeInput,
  opts?: PackCompatOptions,
): { compatible: boolean; reason: string } {
  const packTolerance = opts?.packTolerance ?? 0.5;
  const allowCountToWeight = opts?.allowCountToWeight ?? false;
  const ra = resolveEffectivePack(a);
  const rb = resolveEffectivePack(b);
  const ma = ra.measure;
  const mb = rb.measure;

  if (!ma && !mb) {
    return { compatible: true, reason: "both_unparseable" };
  }

  if (!ma || !mb) {
    const other = ma ?? mb;
    if (
      allowCountToWeight &&
      other &&
      (other.unit === "g" || other.unit === "ml")
    ) {
      return { compatible: true, reason: "null_vs_weight" };
    }
    return { compatible: false, reason: "unparseable_mismatch" };
  }

  if (ma.unit === mb.unit) {
    if (ma.unit === "unit") {
      // Unit stubs (qty missing or ≤1) are not real pack sizes — skip tolerance.
      const skipQty =
        ra.qtyMissing || rb.qtyMissing || ma.quantity <= 1 || mb.quantity <= 1;
      if (!skipQty && ma.quantity > 0) {
        if (Math.abs(mb.quantity - ma.quantity) / ma.quantity > packTolerance) {
          return { compatible: false, reason: "qty_tolerance" };
        }
      }
    } else {
      // g/ml: enforce pack tolerance only when BOTH sides have a real pack qty.
      // Catalog stubs of 1g/1ml (common on generic commodity rows) must not
      // reject every real tub/bottle peer (חומוס 1g vs אחלה 400g).
      const stubA = ra.qtyMissing || ma.quantity <= 1;
      const stubB = rb.qtyMissing || mb.quantity <= 1;
      if (!stubA && !stubB && ma.quantity > 0) {
        if (Math.abs(mb.quantity - ma.quantity) / ma.quantity > packTolerance) {
          return { compatible: false, reason: "qty_tolerance" };
        }
      }
    }
    return { compatible: true, reason: "same_unit" };
  }

  if (isCountWeightPair(ma.unit, mb.unit)) {
    // Count↔weight only when the caller opted in (produce / pita_flatbread).
    // Name-inferred "10 יח" packs are resolved to unit above when present; they
    // still need allowCountToWeight to pair with a g/ml peer. Pantry stays strict.
    if (allowCountToWeight) {
      return { compatible: true, reason: "count_weight" };
    }
    return { compatible: false, reason: "count_weight_blocked" };
  }

  return { compatible: false, reason: "unit_mismatch" };
}
