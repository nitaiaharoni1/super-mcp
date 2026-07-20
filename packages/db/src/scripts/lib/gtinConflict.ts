/**
 * Pure helpers for GTIN cross-chain name/class conflict detection.
 * Kept free of DB I/O so unit tests can cover quarantine decisions.
 */

export interface ListingConflictSide {
  listingId: string;
  chainId: string;
  itemCode: string;
  listingName: string;
  productId: string;
  productName: string;
  productGtin: string;
  /** class_l1 of the listing's own name (when classified). */
  listingClassL1: string | null;
  /** class_l1 of the GTIN product name (when classified). */
  productClassL1: string | null;
}

export interface GtinConflict {
  gtin: string;
  productId: string;
  productName: string;
  listingId: string;
  chainId: string;
  itemCode: string;
  listingName: string;
  nameSimilarity: number;
  classL1Listing: string | null;
  classL1Product: string | null;
  reason: "name_dissimilar" | "class_l1_mismatch" | "both";
  severe: boolean;
}

/** Normalize retail names before similarity (punctuation, spaces, common variants). */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[״"׳']/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/ניילון/g, "נילון")
    .replace(/וואקום/g, "ואקום")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize Hebrew/Latin product names for cheap set similarity. */
export function tokenizeName(name: string): string[] {
  return normalizeName(name)
    .split(/[\s,.\-/\\|:+*×]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function diceSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function charBigrams(s: string): Set<string> {
  const compact = normalizeName(s).replace(/\s+/g, "");
  const out = new Set<string>();
  if (compact.length < 2) {
    if (compact) out.add(compact);
    return out;
  }
  for (let i = 0; i < compact.length - 1; i++) out.add(compact.slice(i, i + 2));
  return out;
}

/**
 * Similarity in [0,1]: max(token Dice, char-bigram Dice, truncation containment).
 * Truncation: short POS feed names often cut mid-word vs the longer product.name.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokenSim = diceSets(new Set(tokenizeName(a)), new Set(tokenizeName(b)));
  const charSim = diceSets(charBigrams(a), charBigrams(b));

  // Truncation / prefix: shorter name largely contained in the longer.
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  const compactS = shorter.replace(/\s+/g, "");
  const compactL = longer.replace(/\s+/g, "");
  let containSim = 0;
  if (compactS.length >= 4 && compactL.includes(compactS)) {
    containSim = compactS.length / compactL.length;
  } else if (shorter.length >= 4 && longer.includes(shorter)) {
    containSim = shorter.length / longer.length;
  }

  return Math.max(tokenSim, charSim, containSim);
}

export function classifyConflict(opts: {
  gtin: string;
  productId: string;
  productName: string;
  listingId: string;
  chainId: string;
  itemCode: string;
  listingName: string;
  classL1Listing: string | null;
  classL1Product: string | null;
  /** Name similarity below this is a conflict (default 0.2). */
  nameThreshold?: number;
  /** Below this → severe (default 0.1). */
  severeThreshold?: number;
}): GtinConflict | null {
  const nameThreshold = opts.nameThreshold ?? 0.2;
  const severeThreshold = opts.severeThreshold ?? 0.1;
  const sim = nameSimilarity(opts.listingName, opts.productName);
  const nameBad = sim < nameThreshold;
  const classBad =
    opts.classL1Listing != null &&
    opts.classL1Product != null &&
    opts.classL1Listing !== opts.classL1Product;

  if (!nameBad && !classBad) return null;

  const reason: GtinConflict["reason"] =
    nameBad && classBad ? "both" : nameBad ? "name_dissimilar" : "class_l1_mismatch";
  const severe = sim < severeThreshold || (classBad && sim < nameThreshold);

  return {
    gtin: opts.gtin,
    productId: opts.productId,
    productName: opts.productName,
    listingId: opts.listingId,
    chainId: opts.chainId,
    itemCode: opts.itemCode,
    listingName: opts.listingName,
    nameSimilarity: sim,
    classL1Listing: opts.classL1Listing,
    classL1Product: opts.classL1Product,
    reason,
    severe,
  };
}

/**
 * Pick which listings to quarantine for a GTIN product group.
 * Unlinks listings whose names diverge from the product name (or class_l1).
 * Always keeps at least one listing on the GTIN product (highest similarity).
 */
export function pickListingsToQuarantine(
  sides: ListingConflictSide[],
  opts?: { nameThreshold?: number; severeOnly?: boolean; severeThreshold?: number },
): GtinConflict[] {
  if (sides.length < 2) return [];
  const nameThreshold = opts?.nameThreshold ?? 0.2;
  const severeThreshold = opts?.severeThreshold ?? 0.1;
  const severeOnly = opts?.severeOnly ?? false;

  const scored = sides.map((side) => {
    const conflict = classifyConflict({
      gtin: side.productGtin,
      productId: side.productId,
      productName: side.productName,
      listingId: side.listingId,
      chainId: side.chainId,
      itemCode: side.itemCode,
      listingName: side.listingName,
      classL1Listing: side.listingClassL1,
      classL1Product: side.productClassL1,
      nameThreshold,
      severeThreshold,
    });
    return {
      side,
      conflict,
      sim: nameSimilarity(side.listingName, side.productName),
    };
  });

  const conflicts = scored
    .filter((s) => s.conflict != null)
    .filter((s) => !severeOnly || s.conflict!.severe)
    .map((s) => s.conflict!);

  // Keep the best-matching listing on the GTIN product.
  if (conflicts.length > 0 && conflicts.length >= sides.length) {
    conflicts.sort((a, b) => b.nameSimilarity - a.nameSimilarity);
    conflicts.shift();
  }
  return conflicts;
}

export function sourceKeyForListing(chainId: string, itemCode: string): string {
  return `${chainId}:${itemCode}`;
}
