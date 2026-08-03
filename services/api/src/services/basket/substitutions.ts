import { rankingDistanceKm } from "./recommendStores.js";
import type {
  BasketCandidate,
  BasketItemStatus,
  BasketLine,
  BasketStoreResult,
  MultiStoreLine,
  MultiStoreStop,
  ResolvedItem,
} from "./types.js";

/** Draft multi-store selection before coverage metrics are attached. */
export interface MultiStorePlanDraft {
  total: number;
  currency: string;
  storeCount: number;
  lines: MultiStoreLine[];
  missingItemIndexes: number[];
  stops: MultiStoreStop[];
  maxDistanceKm: number | null;
  estimatedTravelKm: number | null;
  clubOnlyLines: number;
  couponOnlyLines: number;
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

/**
 * Provenance for the last-resort tier: same class and variant, but the name
 * never repeats what the shopper typed.
 *
 * Deliberately wordier than the others. This is the one substitution the
 * shopper is most likely to want to overrule, so the sentence has to say plainly
 * that the match rests on category alone.
 */
export function classFallbackReason(primaryName: string | null, selectedName: string): string {
  const primary = primaryName ?? "the resolved product";
  return (
    `class_fallback: this chain lists no product named like "${primary}", so priced ` +
    `"${selectedName}" on category and variant alone. Worth confirming.`
  );
}

/**
 * Provenance for a same-brand compatible pack priced under brand_family intent
 * (e.g. selected 95g Taster's → local 100g original).
 */
export function brandFamilyEquivalentReason(
  primaryName: string | null,
  selectedName: string,
  primarySizeQty: number | null | undefined,
  selectedSizeQty: number | null | undefined,
): string {
  const primary = primaryName ?? "the resolved product";
  const sizes =
    primarySizeQty != null && selectedSizeQty != null
      ? ` (${primarySizeQty}→${selectedSizeQty})`
      : "";
  return `brand_family_equivalent: priced same-brand compatible pack "${selectedName}"${sizes} for "${primary}".`;
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

/**
 * Extra shekels a store must shave off the running total to justify one more
 * shopping stop. Prevents the plan from spreading to a 7th store to save loose
 * change — a naive cheapest-per-item split did exactly that.
 */
const MULTISTORE_MIN_MARGINAL_SAVINGS = 20;
/** Hard ceiling on cost-only store additions once full coverage is reached. */
const MULTISTORE_MAX_STORES = 4;

export interface MultiStorePlanOptions {
  /** Marginal savings (₪) required to add a cost-only store. */
  minMarginalSavings?: number;
  /** Cap on total stores (coverage still takes precedence over this cap). */
  maxStores?: number;
  /**
   * Shekels of "cost" per km. An extra stop has to beat its own driving cost, not
   * just a flat threshold — the plan previously ignored distance entirely and
   * would happily send a shopper 9km across town to save ₪21.
   */
  distancePenaltyPerKm?: number;
  /** When false, distance cannot order the stores, so it is left out of the maths. */
  distanceReliable?: boolean;
}

/** Driving cost charged for adding a stop, on top of the flat savings floor. */
function stopTravelCost(
  store: BasketStoreResult,
  opts: MultiStorePlanOptions,
): number {
  if (opts.distanceReliable === false) return 0;
  const perKm = opts.distancePenaltyPerKm ?? 0;
  if (perKm <= 0) return 0;
  // Round trip: the shopper drives out and back for this extra stop.
  return rankingDistanceKm(store.distanceKm, store.distanceAccuracy) * perKm * 2;
}

/**
 * Practical multi-store split. A previous cheapest-per-item pass spread the
 * basket across every store that happened to hold the single cheapest SKU (7
 * stores for a 19-line list) — technically minimal, uselessly impractical.
 *
 * Instead:
 *  1. Greedy set-cover picks the FEWEST stores that price every coverable line
 *     (full coverage is preserved — never traded for fewer stops), preferring
 *     the store that adds the most new coverage, then the cheapest such store.
 *  2. A bounded cost pass then adds another store ONLY when the cheaper prices it
 *     unlocks beat MULTISTORE_MIN_MARGINAL_SAVINGS, up to maxStores.
 * Each covered line is finally priced at the cheapest SKU among the chosen stores.
 */
export function buildMultiStorePlan(
  resolvedItems: ResolvedItem[],
  storeResults: BasketStoreResult[],
  opts: MultiStorePlanOptions = {},
): MultiStorePlanDraft | null {
  if (storeResults.length === 0) return null;
  const minSavings = opts.minMarginalSavings ?? MULTISTORE_MIN_MARGINAL_SAVINGS;
  const maxStores = opts.maxStores ?? MULTISTORE_MAX_STORES;

  // Cheapest line per (item, store) and the set of coverable item indexes.
  const pricing: Array<{ itemIndex: number; byStore: Map<string, BasketLine> }> = [];
  const missingItemIndexes: number[] = [];
  for (const item of resolvedItems) {
    if (!item.productId) {
      missingItemIndexes.push(item.index);
      continue;
    }
    const byStore = new Map<string, BasketLine>();
    for (const store of storeResults) {
      const line = store.lines.find((l) => l.itemIndex === item.index);
      if (line) byStore.set(store.storeId, line);
    }
    if (byStore.size === 0) {
      missingItemIndexes.push(item.index);
      continue;
    }
    pricing.push({ itemIndex: item.index, byStore });
  }
  if (pricing.length === 0) return null;

  const storeById = new Map(storeResults.map((s) => [s.storeId, s]));
  const orderedStoreIds = storeResults.map((s) => s.storeId);

  const planTotalFor = (stores: Set<string>): number => {
    let total = 0;
    for (const p of pricing) {
      let min = Number.POSITIVE_INFINITY;
      for (const sid of stores) {
        const line = p.byStore.get(sid);
        if (line && line.lineTotal < min) min = line.lineTotal;
      }
      if (min < Number.POSITIVE_INFINITY) total += min;
    }
    return total;
  };

  const selected = new Set<string>();

  // Phase 1 — greedy set cover: fewest stores that cover every coverable line.
  // Among stores adding equal coverage, prefer the one whose basket-plus-driving
  // cost is lowest, so a nearer store wins ties instead of an arbitrary cheaper one.
  const uncovered = new Set(pricing.map((p) => p.itemIndex));
  while (uncovered.size > 0) {
    let bestStore: string | null = null;
    let bestNewCover = 0;
    let bestAddedCost = Number.POSITIVE_INFINITY;
    for (const sid of orderedStoreIds) {
      if (selected.has(sid)) continue;
      const store = storeById.get(sid);
      if (!store) continue;
      let newCover = 0;
      let addedCost = 0;
      for (const p of pricing) {
        if (!uncovered.has(p.itemIndex)) continue;
        const line = p.byStore.get(sid);
        if (line) {
          newCover += 1;
          addedCost += line.lineTotal;
        }
      }
      if (newCover === 0) continue;
      // The first store is the anchor trip, which the shopper makes regardless.
      const effectiveAddedCost =
        addedCost + (selected.size === 0 ? 0 : stopTravelCost(store, opts));
      if (
        newCover > bestNewCover ||
        (newCover === bestNewCover && effectiveAddedCost < bestAddedCost)
      ) {
        bestStore = sid;
        bestNewCover = newCover;
        bestAddedCost = effectiveAddedCost;
      }
    }
    if (!bestStore) break; // remaining items unpriceable anywhere
    selected.add(bestStore);
    for (const p of pricing) {
      if (uncovered.has(p.itemIndex) && p.byStore.has(bestStore)) {
        uncovered.delete(p.itemIndex);
      }
    }
  }

  // Phase 2 — add a cost-only store only when its savings beat BOTH the flat
  // "worth another stop" floor and the driving cost of getting there.
  while (selected.size < maxStores) {
    const currentTotal = planTotalFor(selected);
    let bestStore: string | null = null;
    let bestNetSavings = 0;
    for (const sid of orderedStoreIds) {
      if (selected.has(sid)) continue;
      const store = storeById.get(sid);
      if (!store) continue;
      const trial = new Set(selected);
      trial.add(sid);
      const savings = currentTotal - planTotalFor(trial);
      if (savings < minSavings) continue;
      const netSavings = savings - stopTravelCost(store, opts);
      if (netSavings > bestNetSavings) {
        bestStore = sid;
        bestNetSavings = netSavings;
      }
    }
    if (!bestStore || bestNetSavings <= 0) break;
    selected.add(bestStore);
  }

  // Price each covered line at the cheapest SKU among the chosen stores.
  const lines: MultiStoreLine[] = [];
  for (const p of pricing) {
    let best: { store: BasketStoreResult; line: BasketLine } | null = null;
    for (const sid of selected) {
      const line = p.byStore.get(sid);
      if (!line) continue;
      if (!best || line.lineTotal < best.line.lineTotal) {
        best = { store: storeById.get(sid)!, line };
      }
    }
    if (!best) {
      missingItemIndexes.push(p.itemIndex);
      continue;
    }
    lines.push({
      itemIndex: p.itemIndex,
      productId: best.line.productId,
      name: best.line.name,
      qty: best.line.qty,
      storeId: best.store.storeId,
      storeName: best.store.storeName,
      chainName: best.store.chainName,
      address: best.store.address,
      distanceKm: best.store.distanceKm,
      lineTotal: best.line.lineTotal,
      unitPrice: best.line.unitPrice,
      promoApplied: best.line.promoApplied,
      promoDescription: best.line.promoDescription,
      clubOnly: best.line.clubOnly,
      couponOnly: best.line.couponOnly,
      link: best.line.link,
    });
  }

  if (lines.length === 0) return null;
  lines.sort((a, b) => a.itemIndex - b.itemIndex);
  missingItemIndexes.sort((a, b) => a - b);

  const usedStoreIds = [...new Set(lines.map((l) => l.storeId))];
  const total = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

  // Report the trip, not just the price: a 3-stop plan is only a real option if
  // the shopper can see how far it spreads.
  const stops: MultiStoreStop[] = usedStoreIds.map((sid) => {
    const store = storeById.get(sid)!;
    const storeLines = lines.filter((l) => l.storeId === sid);
    return {
      storeId: sid,
      storeName: store.storeName,
      chainName: store.chainName,
      address: store.address,
      distanceKm: store.distanceKm,
      distanceAccuracy: store.distanceAccuracy,
      subtotal: Math.round(storeLines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
      lines: storeLines.length,
    };
  });
  stops.sort(
    (a, b) =>
      (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
      a.storeId.localeCompare(b.storeId),
  );
  const knownDistances = stops
    .map((s) => s.distanceKm)
    .filter((km): km is number => km != null);
  const maxDistanceKm =
    knownDistances.length > 0 ? Math.max(...knownDistances) : null;
  const estimatedTravelKm =
    knownDistances.length === stops.length && stops.length > 0
      ? Math.round(knownDistances.reduce((s, km) => s + km, 0) * 2 * 10) / 10
      : null;

  return {
    total,
    currency: storeResults[0]?.currency ?? "ILS",
    storeCount: usedStoreIds.length,
    lines,
    missingItemIndexes,
    stops,
    maxDistanceKm,
    estimatedTravelKm,
    clubOnlyLines: lines.reduce((n, l) => n + (l.clubOnly ? 1 : 0), 0),
    couponOnlyLines: lines.reduce((n, l) => n + (l.couponOnly ? 1 : 0), 0),
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
