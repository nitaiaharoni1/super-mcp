import {
  buildQueryProfile,
  normalizeEmbedInput,
  parseExplicitPackConstraints,
  resolvePurchaseQty,
  tokenizeNormalized,
  type OntologySnapshot,
  type QueryProfile,
} from "@super-mcp/shared";
import { queryHeadAnchored } from "./equivalence.js";
import { assertPurchaseQtyPreservesRequest } from "./purchaseQtyGuard.js";
import { filterSafeCandidates, rankSafeCandidatesForFast } from "./rankQueryCandidates.js";
import { isEligibleForFastBestEffortCandidate } from "./resolutionDecision.js";
import { isVectorOnly } from "./vectorOnly.js";
import type {
  BasketAssumption,
  BasketCandidate,
  BasketItemInput,
  CandidateAvailability,
  ResolvedItem,
} from "./types.js";

export type FastResolutionOutcome =
  | {
      kind: "selected";
      item: ResolvedItem;
      assumption: BasketAssumption | null;
    }
  | {
      kind: "omitted";
      item: ResolvedItem;
      assumption: BasketAssumption;
    };

export interface FastResolutionPolicyResult {
  items: ResolvedItem[];
  assumptions: BasketAssumption[];
}

const PROCESSED_CHICKEN_TOKENS: ReadonlySet<string> = new Set([
  "קפוא",
  "קפואה",
  "מעובד",
  "מעושן",
  "נקניק",
  "נקניקיות",
  "שניצל",
  "נאגטס",
]);

function isSafelyPricable(item: ResolvedItem): boolean {
  return item.resolutionStatus === "resolved" || (item.productId != null && !item.lowConfidence);
}

/**
 * Same profile builder the resolve/rank path uses (`buildQueryProfile` + ontology
 * extractConstraints) so brand/variant/dietary/organic/fat hard attrs feed
 * `filterSafeCandidates`. Lexical-only fallback when ontology is unavailable.
 */
function buildProfileForFast(
  item: BasketItemInput,
  ontology: OntologySnapshot | null,
): QueryProfile {
  const query = item.query?.trim() ?? "";
  if (ontology && query) {
    return buildQueryProfile(query, ontology, {
      amount: item.amount ?? null,
      unit: item.unit ?? null,
    });
  }

  const parsed = parseExplicitPackConstraints(query);
  const attributes: Record<string, string> = {};
  if (parsed.pieceCount) attributes.piece_count = parsed.pieceCount;
  const requestedAmount =
    item.amount != null && item.unit?.trim()
      ? { quantity: item.amount, unit: item.unit.trim() }
      : parsed.requestedAmount;

  return {
    normalizedText: normalizeEmbedInput(query),
    coreTerms: tokenizeNormalized(normalizeEmbedInput(query)),
    category: null,
    attributes,
    requestedAmount,
  };
}

function hasLocalAvailability(
  candidate: BasketCandidate,
  availability: Map<string, CandidateAvailability>,
): boolean {
  if (candidate.hasLocalPrice) return true;
  return (availability.get(candidate.productId)?.pricedStoreCount ?? 0) > 0;
}

function candidateLooksVectorOnly(candidate: BasketCandidate): boolean {
  return isVectorOnly({
    matchedVia: candidate.matchedVia,
    lexicalScore: candidate.matchedVia === "vector" ? 0 : candidate.score,
  });
}

function shareCompatibleClass(candidates: BasketCandidate[]): boolean {
  const l1 = [
    ...new Set(candidates.map((c) => c.classL1).filter((x): x is string => x != null && x !== "")),
  ];
  if (l1.length > 1) return false;
  if (l1.length === 1) return true;
  const flat = [
    ...new Set(
      candidates.map((c) => c.productClass).filter((x): x is string => x != null && x !== ""),
    ),
  ];
  return flat.length <= 1;
}

function nameHasProcessedChicken(name: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(name));
  return tokens.some((t) => PROCESSED_CHICKEN_TOKENS.has(t));
}

function assumptionReasonFor(query: string): BasketAssumption["reason"] {
  const tokens = tokenizeNormalized(normalizeEmbedInput(query));
  if (
    (tokens.length === 1 && tokens[0] === "חלב") ||
    query.includes("תבנית") ||
    (tokens.includes("שמן") && !tokens.includes("אמבט")) ||
    tokens.includes("עוף")
  ) {
    return "generic_variant_default";
  }
  return "commodity_best_effort";
}

function assumptionMessage(query: string, selectedName: string): string {
  return `Assumed "${selectedName}" for "${query}".`;
}

function omitOutcome(
  item: ResolvedItem,
  input: BasketItemInput,
  message?: string,
): FastResolutionOutcome {
  const query = input.query?.trim() ?? null;
  const assumption: BasketAssumption = {
    itemIndex: item.index,
    query,
    selectedProductId: null,
    selectedName: null,
    reason: "unsafe_line_omitted",
    message:
      message ??
      `No safe locally priced match for "${query ?? item.name ?? `item ${item.index + 1}`}"; omitted from basket.`,
  };
  return {
    kind: "omitted",
    item: {
      ...item,
      productId: null,
      name: query ?? item.name,
      resolvedBy: "unresolved",
      resolutionStatus: "unresolved",
      lowConfidence: true,
      confidence: null,
    },
    assumption,
  };
}

function selectOutcome(
  item: ResolvedItem,
  input: BasketItemInput,
  chosen: BasketCandidate,
): FastResolutionOutcome {
  const purchase = resolvePurchaseQty({
    packQty: input.packQty,
    amount: input.amount,
    unit: input.unit,
    productSizeQty: chosen.sizeQty,
    productSizeUnit: chosen.sizeUnit,
    productName: chosen.name,
    pieceCount: chosen.pieceCount,
  });

  // Preserve requested physical amount: amount+unit stays on the line metadata.
  const amount = input.amount ?? item.amount;
  const unit = input.unit ?? item.unit;
  const query = input.query?.trim() ?? "";

  assertPurchaseQtyPreservesRequest(input, purchase);

  const assumption: BasketAssumption = {
    itemIndex: item.index,
    query: query || null,
    selectedProductId: chosen.productId,
    selectedName: chosen.name,
    reason: assumptionReasonFor(query),
    message: assumptionMessage(query || chosen.name, chosen.name),
  };

  return {
    kind: "selected",
    item: {
      ...item,
      productId: chosen.productId,
      name: chosen.name,
      qty: purchase.qty,
      qtyMode: purchase.mode,
      amount,
      unit,
      resolvedBy: "query",
      resolutionStatus: "resolved",
      lowConfidence: false,
      confidence: chosen.score,
    },
    assumption,
  };
}

function filterPool(
  item: ResolvedItem,
  query: string,
  profile: QueryProfile,
): BasketCandidate[] {
  const base = filterSafeCandidates({
    query,
    profile,
    candidates: item.candidates,
  }).filter((c) => !candidateLooksVectorOnly(c));

  const withoutProcessedChicken = base.filter(
    (c) =>
      !(
        tokenizeNormalized(normalizeEmbedInput(query)).includes("עוף") &&
        nameHasProcessedChicken(c.name)
      ),
  );

  const anchored = withoutProcessedChicken.filter(
    (c) => !query || queryHeadAnchored(query, c.name),
  );
  return anchored.length > 0 ? anchored : withoutProcessedChicken;
}

function resolveFastOutcome(
  item: ResolvedItem,
  input: BasketItemInput,
  availability: Map<string, CandidateAvailability>,
  ontology: OntologySnapshot | null,
): FastResolutionOutcome {
  if (isSafelyPricable(item)) {
    return { kind: "selected", item, assumption: null };
  }

  const query = input.query?.trim() ?? "";
  const profile = buildProfileForFast(input, ontology);
  const pool = filterPool(item, query, profile);

  if (pool.length === 0) {
    return omitOutcome(item, input);
  }

  if (!shareCompatibleClass(pool)) {
    return omitOutcome(
      item,
      input,
      `Ambiguous classes for "${query || item.name}"; omitted rather than guessing.`,
    );
  }

  const tokens = tokenizeNormalized(normalizeEmbedInput(query));
  const ranked = rankSafeCandidatesForFast(pool, availability, profile, {
    preferCanola: tokens.includes("שמן"),
    preferPlainMilk: tokens.length === 1 && tokens[0] === "חלב",
    preferFreshChicken: tokens.includes("עוף"),
  });
  const chosen = ranked[0]!;

  if (!isEligibleForFastBestEffortCandidate(chosen, availability)) {
    return omitOutcome(item, input);
  }

  if (!hasLocalAvailability(chosen, availability)) {
    return omitOutcome(
      item,
      input,
      `No local price for a safe match of "${query || item.name}"; omitted from basket.`,
    );
  }

  return selectOutcome(item, input, chosen);
}

/**
 * Convert unresolved / needs_confirmation lines into selected-or-omitted outcomes.
 * Fast mode never asks; strict confirmation branching happens in optimize.ts.
 */
export function applyFastResolutionPolicy(
  items: BasketItemInput[],
  resolvedItems: ResolvedItem[],
  availability: Map<string, CandidateAvailability>,
  ontology: OntologySnapshot | null = null,
): FastResolutionPolicyResult {
  const assumptions: BasketAssumption[] = [];
  const out: ResolvedItem[] = [];

  for (const item of resolvedItems) {
    const input = items[item.index] ?? {};
    const outcome = resolveFastOutcome(item, input, availability, ontology);
    switch (outcome.kind) {
      case "selected": {
        out.push(outcome.item);
        if (outcome.assumption) assumptions.push(outcome.assumption);
        break;
      }
      case "omitted": {
        out.push(outcome.item);
        assumptions.push(outcome.assumption);
        break;
      }
      default: {
        const exhaustive: never = outcome;
        throw new Error(`unhandled fast resolution outcome: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return { items: out, assumptions };
}
