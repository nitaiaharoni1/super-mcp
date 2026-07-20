import { queryHeadAnchored } from "./equivalence.js";
import { classifyLineRisk, type LineRisk, type RiskCandidate } from "./lineRisk.js";
import type {
  BasketCandidate,
  BasketItemInput,
  BasketItemStatus,
  BasketQuestion,
  BasketSelectionEffect,
  CandidateAvailability,
} from "./types.js";

export const DEFAULT_QUESTION_OPTIONS_LIMIT = 3;

const EMPTY_AVAILABILITY: CandidateAvailability = {
  pricedStoreCount: 0,
  chainCount: 0,
  minPrice: null,
};

/** Worse/missing intent tiers sort after strong matches (tier 1 best; 0/absent last). */
function intentTierRank(tier: BasketCandidate["intentTier"]): number {
  if (tier == null || tier === 0) return Number.POSITIVE_INFINITY;
  return tier;
}

function compareQuestionCandidates(
  a: BasketCandidate,
  b: BasketCandidate,
  availability: Map<string, CandidateAvailability>,
): number {
  const aAvailability = availability.get(a.productId) ?? EMPTY_AVAILABILITY;
  const bAvailability = availability.get(b.productId) ?? EMPTY_AVAILABILITY;
  return (
    intentTierRank(a.intentTier) - intentTierRank(b.intentTier) ||
    Number(bAvailability.pricedStoreCount > 0) - Number(aAvailability.pricedStoreCount > 0) ||
    bAvailability.chainCount - aAvailability.chainCount ||
    (aAvailability.minPrice ?? Number.POSITIVE_INFINITY) -
      (bAvailability.minPrice ?? Number.POSITIVE_INFINITY) ||
    b.score - a.score ||
    a.productId.localeCompare(b.productId)
  );
}

function selectionEffectForRisk(risk: LineRisk): BasketSelectionEffect {
  switch (risk.kind) {
    case "commodity":
      return "representative";
    case "brand_pinned":
    case "cross_class":
    case "opaque":
      return "pin";
    default: {
      const exhaustive: never = risk;
      return exhaustive;
    }
  }
}

function toRiskCandidate(candidate: BasketCandidate): RiskCandidate {
  return {
    productClass: candidate.productClass,
    brand: candidate.brandExtracted ?? null,
    intentTier: candidate.intentTier ?? null,
    classL1: candidate.classL1 ?? null,
  };
}

/**
 * Agent-facing shortlist: head-anchored safety partition, then availability /
 * chain diversity / price / score. Does not mutate the input ranking used for
 * resolution.
 */
export function selectQuestionCandidateShortlist(
  candidates: BasketCandidate[],
  optionsLimit: number,
  availability: Map<string, CandidateAvailability>,
  queryText = "",
): BasketCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (queryText) {
        const aOk = queryHeadAnchored(queryText, a.name);
        const bOk = queryHeadAnchored(queryText, b.name);
        if (aOk !== bOk) return aOk ? -1 : 1;
      }
      return compareQuestionCandidates(a, b, availability);
    })
    .slice(0, optionsLimit);
}

export function collectQuestionOptionProductIds(items: BasketItemStatus[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.resolutionStatus !== "needs_confirmation") continue;
    for (const candidate of item.candidates) {
      ids.add(candidate.productId);
    }
  }
  return [...ids];
}

export function buildBasketQuestions(
  inputItems: BasketItemInput[],
  items: BasketItemStatus[],
  availability: Map<string, CandidateAvailability>,
  optionsLimit: number,
): BasketQuestion[] {
  return items.flatMap((item) => {
    if (item.resolutionStatus !== "needs_confirmation") return [];

    const input = inputItems[item.index];
    const queryText = input?.query?.trim() ?? "";
    const lineLabel = queryText || item.name || `item ${item.index + 1}`;
    const shortlist = selectQuestionCandidateShortlist(
      item.candidates,
      optionsLimit,
      availability,
      queryText,
    );
    const risk = classifyLineRisk(queryText, shortlist.map(toRiskCandidate));

    return [
      {
        itemIndex: item.index,
        id: `basket-item-${item.index}-product`,
        prompt: `Which product should be used for "${lineLabel}"?`,
        reason: "This line has multiple or insufficiently strong product matches.",
        required: true as const,
        selectionEffect: selectionEffectForRisk(risk),
        options: shortlist.map((candidate) => {
          const facts = availability.get(candidate.productId) ?? EMPTY_AVAILABILITY;
          return {
            productId: candidate.productId,
            name: candidate.name,
            pack: {
              pieceCount: candidate.pieceCount,
              sizeQty: candidate.sizeQty,
              sizeUnit: candidate.sizeUnit,
            },
            nearbyPricedStores: facts.pricedStoreCount,
            nearbyPricedChains: facts.chainCount,
            minimumNearbyPrice: facts.minPrice,
          };
        }),
      },
    ];
  });
}
