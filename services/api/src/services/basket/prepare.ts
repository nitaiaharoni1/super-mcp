import { resolveBasketLines } from "./optimize.js";
import type {
  BasketCandidate,
  BasketItemInput,
  BasketItemStatus,
  BasketPrepareInput,
  BasketPrepareQuestion,
  BasketPrepareResult,
  ResolvedItem,
} from "./types.js";

export const DEFAULT_PREPARE_OPTIONS_LIMIT = 5;

export function buildPrepareAssumptions(
  inputItems: BasketItemInput[],
  resolvedItems: ResolvedItem[],
): string[] {
  const assumptions: string[] = [];

  for (const item of resolvedItems) {
    if (item.lowConfidence || !item.productId || item.resolutionStatus === "needs_confirmation") continue;

    const input = inputItems[item.index];
    if (!input?.query || input.productId || input.gtin) continue;

    const label = item.name ?? item.productId;
    assumptions.push(`"${input.query.trim()}" → ${label}`);
  }

  return assumptions;
}

/** Worse/missing intent tiers sort after strong matches (tier 1 best; 0/absent last). */
function prepareIntentTierRank(tier: BasketCandidate["intentTier"]): number {
  if (tier == null || tier === 0) return Number.POSITIVE_INFINITY;
  return tier;
}

/**
 * Agent-facing shortlist order: local stock first, then intent quality, then score.
 * Does not mutate the input ranking used for resolution decisions.
 */
export function selectPrepareCandidateShortlist(
  candidates: BasketCandidate[],
  optionsLimit: number,
): BasketCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (a.hasLocalPrice !== b.hasLocalPrice) return a.hasLocalPrice ? -1 : 1;
      const tierCmp = prepareIntentTierRank(a.intentTier) - prepareIntentTierRank(b.intentTier);
      if (tierCmp !== 0) return tierCmp;
      return b.score - a.score;
    })
    .slice(0, optionsLimit);
}

function serializePrepareItems(
  items: BasketItemStatus[],
  optionsLimit: number,
): BasketItemStatus[] {
  return items.map((item) => ({
    ...item,
    candidates:
      item.resolutionStatus === "resolved"
        ? []
        : selectPrepareCandidateShortlist(item.candidates, optionsLimit),
  }));
}

function buildPrepareQuestions(
  inputItems: BasketItemInput[],
  items: BasketItemStatus[],
  optionsLimit: number,
): BasketPrepareQuestion[] {
  return items.flatMap((item) => {
    if (item.resolutionStatus !== "needs_confirmation") return [];

    const input = inputItems[item.index];
    const lineLabel = input?.query?.trim() || item.name || `item ${item.index + 1}`;
    return [
      {
        itemIndex: item.index,
        id: `basket-item-${item.index}-product`,
        prompt: `Which product should be used for "${lineLabel}"?`,
        reason: "This line has multiple or insufficiently strong product matches.",
        required: true,
        options: selectPrepareCandidateShortlist(item.candidates, optionsLimit).map(
          (candidate) => ({
            productId: candidate.productId,
            name: candidate.name,
            sizeQty: candidate.sizeQty,
            sizeUnit: candidate.sizeUnit,
            hasLocalPrice: candidate.hasLocalPrice,
          }),
        ),
      },
    ];
  });
}

export async function prepareBasket(input: BasketPrepareInput): Promise<BasketPrepareResult> {
  const { resolvedItems, itemStatuses, completeness, location } = await resolveBasketLines(input);
  const assumptions = buildPrepareAssumptions(input.items, resolvedItems);
  const questions = buildPrepareQuestions(
    input.items,
    itemStatuses,
    DEFAULT_PREPARE_OPTIONS_LIMIT,
  );

  return {
    items: serializePrepareItems(itemStatuses, DEFAULT_PREPARE_OPTIONS_LIMIT),
    completeness,
    assumptions,
    questions,
    location,
  };
}
