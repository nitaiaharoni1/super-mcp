import type {
  BasketCandidate,
  BasketItemStatus,
  BasketLine,
  BasketStoreResult,
  MultiStoreLine,
  ResolvedItem,
} from "./types.js";

/** Draft multi-store selection before coverage metrics are attached. */
export interface MultiStorePlanDraft {
  total: number;
  currency: string;
  storeCount: number;
  lines: MultiStoreLine[];
  missingItemIndexes: number[];
}

export function isLineSubstituted(
  item: ResolvedItem,
  candidateProductId: string,
): boolean {
  return Boolean(
    (item.primaryProductId && candidateProductId !== item.primaryProductId) ||
      (item.productId && candidateProductId !== item.productId),
  );
}

/**
 * True when the priced candidate is a member of the line's gated equivalence
 * set (same-class/unit/pack) rather than the resolved primary SKU — the chain
 * carries its own interchangeable SKU instead of the resolved one.
 */
export function isChainEquivalentSubstitution(
  item: ResolvedItem,
  candidateProductId: string,
): boolean {
  if (candidateProductId === item.productId) return false;
  return Boolean(item.equivalents?.some((c) => c.productId === candidateProductId));
}

/**
 * Human-readable reason for a chain-equivalent pricing substitution, naming both
 * the resolved primary and the chain's actual SKU. Prefixed with the machine
 * reason `chain_equivalent` so callers can key off it.
 */
export function chainEquivalentReason(primaryName: string | null, selectedName: string): string {
  const primary = primaryName ?? "the resolved product";
  return `chain_equivalent: priced this chain's "${selectedName}" as a same-class equivalent of "${primary}".`;
}

export function substitutionReasonForLine(
  item: ResolvedItem,
  substituted: boolean,
): string | null {
  if (!substituted) return null;
  return (
    item.substitution?.reason ??
    "Used a locally stocked candidate because the primary SKU was unavailable here."
  );
}

/** Align item statuses with the chosen store plan's actual priced SKUs. */
export function applyStorePlanSubstitutions(
  itemStatuses: BasketItemStatus[],
  topStore: BasketStoreResult,
): void {
  for (const status of itemStatuses) {
    const line = topStore.lines.find((l) => l.itemIndex === status.index);
    if (!line) continue;
    status.qty = line.qty;
    status.qtyMode = line.qtyMode;
    if (line.substituted) {
      const originalId = line.originalProductId;
      const originalName =
        status.candidates.find((c) => c.productId === originalId)?.name ?? status.name;
      status.productId = line.productId;
      status.name = line.name;
      status.substitution = {
        originalProductId: originalId,
        originalName,
        selectedProductId: line.productId,
        selectedName: line.name,
        reason: line.substitutionReason ?? "Locally stocked substitute.",
        changedAttributes: status.substitution?.changedAttributes ?? [],
        confidence: status.confidence,
      };
    }
  }
}

export function buildMultiStorePlan(
  resolvedItems: ResolvedItem[],
  storeResults: BasketStoreResult[],
): MultiStorePlanDraft | null {
  if (storeResults.length === 0) return null;

  const lines: MultiStoreLine[] = [];
  const missingItemIndexes: number[] = [];

  for (const item of resolvedItems) {
    if (!item.productId) {
      missingItemIndexes.push(item.index);
      continue;
    }
    let best: { store: BasketStoreResult; line: BasketLine } | null = null;
    for (const store of storeResults) {
      const line = store.lines.find((l) => l.itemIndex === item.index);
      if (!line) continue;
      if (!best || line.lineTotal < best.line.lineTotal) {
        best = { store, line };
      }
    }
    if (!best) {
      missingItemIndexes.push(item.index);
      continue;
    }
    lines.push({
      itemIndex: item.index,
      productId: best.line.productId,
      name: best.line.name,
      qty: best.line.qty,
      storeId: best.store.storeId,
      storeName: best.store.storeName,
      chainName: best.store.chainName,
      address: best.store.address,
      lineTotal: best.line.lineTotal,
      unitPrice: best.line.unitPrice,
      link: best.line.link,
    });
  }

  if (lines.length === 0) return null;

  const storeCount = new Set(lines.map((l) => l.storeId)).size;
  const total = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

  return {
    total,
    currency: storeResults[0]?.currency ?? "ILS",
    storeCount,
    lines,
    missingItemIndexes,
  };
}

/** Fallback candidate when resolved item has no shortlist. */
export function fallbackCandidate(item: ResolvedItem): BasketCandidate {
  return {
    productId: item.productId!,
    name: item.name ?? "",
    score: item.confidence ?? 0,
    matchedVia: "product",
    sizeQty: null,
    sizeUnit: null,
    pieceCount: null,
    // Synthesized from a resolved item without a priced shortlist; availability
    // is unknown, not guaranteed — never fabricate it as true.
    hasPrice: false,
    hasLocalPrice: false,
    productClass: null,
  };
}
