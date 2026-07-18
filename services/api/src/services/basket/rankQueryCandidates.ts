import {
  buildQueryProfile,
  DEFAULT_SEMANTIC_SEARCH_CONFIG,
  inferPackSizeFromName,
  normalizeMeasure,
  profileFromText,
  rankDeterministicCandidates,
  resolvePurchaseQty,
  type OntologySnapshot,
  type RetrievalEvidence,
  type SemanticProfile,
} from "@super-mcp/shared";
import {
  semanticBasketShadow,
  semanticV2Shadow,
} from "../../lib/features.js";
import type { SearchProductHit } from "../search/types.js";
import { hitToCandidate } from "./candidates.js";
import {
  DEFAULT_CANDIDATE_LIMIT,
  SEMANTIC_CANDIDATE_LIMIT,
} from "./constants.js";
import { decideResolution } from "./resolutionDecision.js";
import type { QueryResolveResult, QuerySearchContext } from "./resolveQuery.js";
import type { BasketSubstitutionMeta } from "./types.js";

export interface RankQueryOptions {
  /** Wall time spent loading profiles for this line (0 when shared batch). */
  profileMs?: number;
  /** Profiles came from a shared batch load across basket lines. */
  sharedProfileBatch?: boolean;
  /**
   * Optional shared cache of ontology-merged profiles keyed by product id.
   * Avoids repeating profileFromText across lines that share candidates.
   */
  mergedProfileCache?: Map<string, SemanticProfile>;
}

function mergeProfileWithCurrentOntology(
  name: string,
  stored: SemanticProfile | Partial<SemanticProfile> | undefined,
  ontology: OntologySnapshot,
  cache?: Map<string, SemanticProfile>,
  productId?: string,
): SemanticProfile {
  if (productId && cache?.has(productId)) {
    return cache.get(productId)!;
  }
  const parsed = profileFromText(name, ontology);
  const merged: SemanticProfile = !stored
    ? parsed
    : {
        // Current ontology terms must take precedence: profiles can predate an ontology update.
        attributes: { ...(stored.attributes ?? {}), ...parsed.attributes },
        concepts: [...new Set([...(stored.concepts ?? []), ...parsed.concepts])],
        penalties: [...new Set([...(stored.penalties ?? []), ...parsed.penalties])],
        conceptTerms: [...new Set([...(stored.conceptTerms ?? []), ...parsed.conceptTerms])],
      };
  if (productId && cache) cache.set(productId, merged);
  return merged;
}

/**
 * Rank and decide a query line from search hits + already-loaded profiles.
 * Pure w.r.t. I/O — callers own profile loading (per-line or batched).
 */
export function rankQueryCandidates(
  ctx: QuerySearchContext,
  profiles: Map<string, SemanticProfile | Partial<SemanticProfile>>,
  options?: RankQueryOptions,
): QueryResolveResult {
  const { item, wantsPackSize, hits: allHits, searchMs, candidateLimit, semantic, ontology, location } =
    ctx;
  const searchConfig = ontology?.searchConfig;
  const profileMs = options?.profileMs ?? 0;
  const sharedProfileBatch = options?.sharedProfileBatch === true;
  const mergedProfileCache = options?.mergedProfileCache;

  // Cap CPU for deterministic ranking: pack-size lines keep a wider pool.
  const rankCap = wantsPackSize
    ? Math.min(allHits.length, candidateLimit)
    : Math.min(allHits.length, searchConfig?.firstPassLexicalLimit ?? 20);
  const hits =
    allHits.length <= rankCap
      ? allHits
      : [...allHits]
          .sort(
            (a, b) =>
              (b.lexicalScore ?? b.evidence?.lexicalScore ?? b.score) -
                (a.lexicalScore ?? a.evidence?.lexicalScore ?? a.score) ||
              a.name.localeCompare(b.name, ontology?.locale ?? "he"),
          )
          .slice(0, rankCap);

  const lexicalPrimary = [...allHits].sort(
    (a, b) =>
      (b.lexicalScore ?? b.evidence?.lexicalScore ?? b.score) -
        (a.lexicalScore ?? a.evidence?.lexicalScore ?? a.score) ||
      a.name.localeCompare(b.name, ontology?.locale ?? "he"),
  )[0];

  const purchaseFor = (hit: SearchProductHit) =>
    resolvePurchaseQty({
      packQty: item.qty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: hit.sizeQty,
      productSizeUnit: hit.sizeUnit,
      productName: hit.name,
    });
  const need = wantsPackSize ? normalizeMeasure(item.amount, item.unit) : null;
  const packMeasureFor = (hit: SearchProductHit) => {
    const inferred = inferPackSizeFromName(hit.name);
    const dbPack =
      hit.sizeQty != null && hit.sizeUnit ? normalizeMeasure(hit.sizeQty, hit.sizeUnit) : null;
    const namePack = inferred ? normalizeMeasure(inferred.quantity, inferred.unit) : null;
    const conflicts =
      dbPack &&
      namePack &&
      !dbPack.unparseable &&
      !namePack.unparseable &&
      dbPack.unit === namePack.unit &&
      Math.abs(dbPack.quantity - namePack.quantity) / namePack.quantity > 0.1;
    return conflicts ? namePack : (dbPack ?? namePack);
  };
  const packageExcess = (hit: SearchProductHit, qty: number) => {
    const pack = packMeasureFor(hit);
    return need && pack && !pack.unparseable && pack.unit === need.unit
      ? Math.max(0, pack.quantity * qty - need.quantity)
      : Number.POSITIVE_INFINITY;
  };
  const defaultEvidence = (hit: SearchProductHit): RetrievalEvidence => ({
    exactName: false,
    exactPhrase: false,
    matchedTokenCount: 0,
    queryTokenCount: 0,
    trigramSimilarity: null,
    aliasMatched: hit.matchedVia === "alias",
    vectorDistance: hit.vectorDistance ?? null,
    lexicalScore: hit.lexicalScore ?? null,
  });

  let ranked: Array<SearchProductHit & { intentTier?: 1 | 2 | 3 | 0 }>;
  const gateById = new Map<
    string,
    { tier: 1 | 2 | 3 | 0; relaxed: string[]; penaltyScore: number }
  >();
  let rankMs = 0;

  if (ontology) {
    const rankStarted = Date.now();
    const queryProfile = buildQueryProfile(item.query!, ontology, {
      amount: item.amount ?? null,
      unit: item.unit ?? null,
    });
    const deterministic = rankDeterministicCandidates(
      queryProfile,
      hits.map((hit) => {
        const purchase = purchaseFor(hit);
        const profile = mergeProfileWithCurrentOntology(
          hit.name,
          profiles.get(hit.id),
          ontology,
          mergedProfileCache,
          hit.id,
        );
        return {
          id: hit.id,
          name: hit.name,
          profile,
          evidence: { ...defaultEvidence(hit), ...hit.evidence, vectorDistance: hit.vectorDistance ?? null },
          hasLocalPrice: hit.hasLocalPrice,
          hasPrice: hit.hasPrice,
          packExcess: packageExcess(hit, purchase.qty),
        };
      }),
      ontology,
    );
    const hitsById = new Map(hits.map((hit) => [hit.id, hit]));
    ranked = deterministic.flatMap((candidate) => {
      gateById.set(candidate.id, {
        tier: candidate.gate.tier,
        relaxed: candidate.gate.relaxed,
        penaltyScore: candidate.gate.penaltyScore,
      });
      const hit = hitsById.get(candidate.id);
      return hit ? [{ ...hit, intentTier: candidate.gate.tier }] : [];
    });
    rankMs = Date.now() - rankStarted;
    if (
      (semanticV2Shadow() || semanticBasketShadow()) &&
      lexicalPrimary &&
      ranked[0] &&
      lexicalPrimary.id !== ranked[0].id
    ) {
      console.log(
        JSON.stringify({
          event: semanticV2Shadow() ? "semantic_v2_shadow" : "semantic_basket_shadow",
          lexicalId: lexicalPrimary.id,
          semanticId: ranked[0].id,
          intentTier: ranked[0].intentTier,
          ontologyVersion: ontology.version,
          city: location?.city ?? null,
        }),
      );
    }
  } else {
    const rankStarted = Date.now();
    ranked = [...hits].sort(
      (a, b) =>
        (b.lexicalScore ?? b.evidence?.lexicalScore ?? b.score) -
          (a.lexicalScore ?? a.evidence?.lexicalScore ?? a.score) ||
        a.name.localeCompare(b.name, "he"),
    );
    rankMs = Date.now() - rankStarted;
  }

  const shortlistCap = semantic
    ? Math.min(candidateLimit, SEMANTIC_CANDIDATE_LIMIT)
    : DEFAULT_CANDIDATE_LIMIT;
  const shortlist = ranked.slice(0, shortlistCap);
  if (wantsPackSize) {
    const seen = new Set(shortlist.map((hit) => hit.id));
    for (const hit of ranked) {
      if (shortlist.length >= shortlistCap + 3) break;
      if (seen.has(hit.id) || purchaseFor(hit).mode !== "packs") continue;
      shortlist.push(hit);
      seen.add(hit.id);
    }
  }
  const decision = decideResolution(
    item.query ?? "",
    shortlist.map((hit) => ({
      ...hit,
      lexicalScore: hit.lexicalScore ?? hit.evidence?.lexicalScore ?? null,
      evidence: { ...defaultEvidence(hit), ...hit.evidence },
      // Without ontology profiles, only an exact normalized product name is
      // safe to auto-price; lexical-only phrase/prefix matches need review.
      intentTier: ontology
        ? gateById.get(hit.id)?.tier
        : hit.evidence?.exactName
          ? 1
          : 3,
      penaltyScore: ontology ? (gateById.get(hit.id)?.penaltyScore ?? 0) : 0,
      profile: ontology
        ? mergeProfileWithCurrentOntology(
            hit.name,
            profiles.get(hit.id),
            ontology,
            mergedProfileCache,
            hit.id,
          )
        : undefined,
    })),
    searchConfig ?? DEFAULT_SEMANTIC_SEARCH_CONFIG,
  );
  console.log(
    JSON.stringify({
      event: "basket_resolve_line",
      searchMs,
      profileMs,
      rankMs,
      candidateCount: hits.length,
      resolutionStatus: decision.status,
      ...(sharedProfileBatch ? { profileBatchShared: true } : {}),
    }),
  );
  const chosen = decision.productId
    ? (shortlist.find((hit) => hit.id === decision.productId) ?? shortlist[0])
    : shortlist[0];
  if (!chosen) {
    return {
      qty: item.qty ?? item.amount ?? 1,
      qtyMode: "legacy_packs",
      productId: null,
      name: item.query ?? null,
      resolvedBy: "unresolved",
      confidence: null,
      lowConfidence: true,
      candidates: [],
      primaryProductId: null,
      primaryName: null,
      substitution: null,
      resolutionStatus: decision.status,
    };
  }
  const purchase = resolvePurchaseQty({
    packQty: item.qty,
    amount: item.amount,
    unit: item.unit,
    productSizeQty: chosen.sizeQty,
    productSizeUnit: chosen.sizeUnit,
    productName: chosen.name,
  });

  let substitution: BasketSubstitutionMeta | null = null;
  if (
    decision.autoPrice &&
    lexicalPrimary &&
    chosen.id !== lexicalPrimary.id &&
    (decision.confidence ?? 0) >=
      (searchConfig?.substitutionMinConfidence ??
        DEFAULT_SEMANTIC_SEARCH_CONFIG.substitutionMinConfidence) &&
    (gateById.get(chosen.id)?.tier ?? 1) <= 2
  ) {
    substitution = {
      originalProductId: lexicalPrimary.id,
      originalName: lexicalPrimary.name,
      selectedProductId: chosen.id,
      selectedName: chosen.name,
      reason: chosen.hasLocalPrice
        ? "Selected a locally stocked equivalent of the top name match."
        : "Selected a better attribute/score match among candidates.",
      changedAttributes: gateById.get(chosen.id)?.relaxed ?? [],
      confidence: decision.confidence,
    };
  }

  return {
    qty: purchase.qty,
    qtyMode: purchase.mode,
    productId: decision.autoPrice ? chosen.id : null,
    name: chosen.name,
    resolvedBy: decision.autoPrice ? "query" : "unresolved",
    confidence: decision.confidence,
    lowConfidence: decision.lowConfidence,
    candidates: shortlist.map(hitToCandidate),
    primaryProductId: lexicalPrimary?.id ?? chosen.id,
    primaryName: lexicalPrimary?.name ?? chosen.name,
    substitution,
    resolutionStatus: decision.status,
  };
}
