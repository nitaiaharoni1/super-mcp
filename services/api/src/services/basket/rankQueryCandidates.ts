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
import type { ProductClassInfo } from "./productClasses.js";
import {
  DEFAULT_CANDIDATE_LIMIT,
  SEMANTIC_CANDIDATE_LIMIT,
} from "./constants.js";
import {
  buildAvailabilityEquivalents,
  buildCommodityEquivalents,
} from "./equivalence.js";
import { brandMatches, classifyLineRisk, type RiskCandidate } from "./lineRisk.js";
import { decideResolution } from "./resolutionDecision.js";
import type { QueryResolveResult, QuerySearchContext } from "./resolveQuery.js";
import type { BasketCandidate, BasketSubstitutionMeta } from "./types.js";

/**
 * A candidate that may participate in the commodity auto-resolve override.
 * Mirrors `isVectorOnly` in resolutionDecision.ts EXACTLY: a hit with no lexical
 * evidence (no lexicalScore > 0 and no exact/phrase/alias name evidence) that was
 * recalled only via the vector index. The invariant "vector-only never auto-prices"
 * MUST hold here, so we never widen/override such a top pick.
 */
function isVectorOnlyHit(hit: SearchProductHit): boolean {
  const ev = hit.evidence;
  const lex = hit.lexicalScore ?? ev?.lexicalScore ?? null;
  const hasLexicalEvidence =
    (lex != null && lex > 0) ||
    Boolean(ev?.exactName || ev?.exactPhrase || ev?.aliasMatched);
  return (
    !hasLexicalEvidence &&
    (hit.vectorDistance != null || hit.matchedVia === "vector")
  );
}

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
  /** Offline LLM taxonomy paths keyed by product id (migration 017). */
  classMap?: Map<string, ProductClassInfo>;
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
  const classMap = options?.classMap;

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
  // Same product_class the semantic gate reads (profile.attributes.product_class);
  // sourcing it here keeps equivalence classes aligned with the gate's notion of class.
  const productClassFor = (hit: SearchProductHit): string | null => {
    if (!ontology) return null;
    const profile = mergeProfileWithCurrentOntology(
      hit.name,
      profiles.get(hit.id),
      ontology,
      mergedProfileCache,
      hit.id,
    );
    return profile.attributes?.product_class ?? null;
  };

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
      classPath: classMap?.get(hit.id),
      variant: classMap?.get(hit.id)?.variant ?? null,
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

  // Build the candidate list once so risk classification, equivalence, and the
  // response all read the same product_class / intentTier the gate assigned.
  const candidates: BasketCandidate[] = shortlist.map((hit) =>
    hitToCandidate(hit, productClassFor(hit), classMap?.get(hit.id)),
  );
  // BasketCandidate drops brand; the risk classifier needs it, so keep the raw
  // hit brand keyed by product id.
  const shortlistBrandById = new Map<string, string | null>(
    shortlist.map((hit) => [hit.id, hit.brand ?? null]),
  );

  const base = {
    qty: purchase.qty,
    qtyMode: purchase.mode,
    productId: decision.autoPrice ? chosen.id : null,
    name: chosen.name,
    resolvedBy: (decision.autoPrice ? "query" : "unresolved") as "query" | "unresolved",
    confidence: decision.confidence,
    lowConfidence: decision.lowConfidence,
    candidates,
    primaryProductId: lexicalPrimary?.id ?? chosen.id,
    primaryName: lexicalPrimary?.name ?? chosen.name,
    substitution,
    resolutionStatus: decision.status,
  };

  // Risk-aware overrides. Same-class near-duplicate ambiguity (commodity) is
  // pricing detail, not a user decision; brand-pinning / cross-class ambiguity
  // genuinely changes WHAT the user gets and must still confirm.
  const risk = classifyLineRisk(
    item.query ?? "",
    candidates.map(
      (c): RiskCandidate => ({
        productClass: c.productClass,
        brand: shortlistBrandById.get(c.productId) ?? null,
        intentTier: c.intentTier ?? null,
        classL1: c.classL1 ?? null,
      }),
    ),
  );

  // Commodity override: a confirmation caused purely by same-class margin
  // ambiguity auto-resolves to the top pick with an equivalence set attached.
  // HARD GUARD: never override a vector-only top pick (invariant: vector-only
  // can't auto-price), and only for commodity risk — never cross_class/opaque.
  // Uses the query-token-safe builder so a brand/variety query (טסטרס צ'ויס)
  // never groups a different brand of the same class (עלית צ'יקו).
  if (
    decision.status === "needs_confirmation" &&
    risk.kind === "commodity" &&
    candidates[0] != null &&
    shortlist[0] != null &&
    !isVectorOnlyHit(shortlist[0])
  ) {
    const equivalents = buildCommodityEquivalents(
      candidates[0],
      candidates,
      item.query ?? "",
      searchConfig?.maxEquivalents ?? 5,
      searchConfig?.packTolerance ?? 0.5,
    );
    if (equivalents.length >= 2) {
      const top = candidates[0];
      return {
        ...base,
        productId: top.productId,
        name: top.name,
        resolvedBy: "query",
        confidence: base.confidence ?? top.score,
        lowConfidence: false,
        resolutionStatus: "resolved",
        equivalents,
      };
    }
  }

  // Availability commodity override: the class-gated branch above can't fire for
  // the ~95% of the catalog with NO product_class (risk === "opaque"), so a
  // generic staple every store stocks (חומוס, טחינה, מלח גס, אבטיח) was forced
  // to a needless question. When ≥2 locally-available, query-safe, non-penalized
  // products share a unit, auto-resolve to that group and let per-chain pricing
  // pick the cheapest — availability + query specificity stand in for the missing
  // class signal. Never fires for brand_pinned (respect the named brand) or
  // cross_class (a genuine either/or the user must decide), nor for a vector-only
  // top pick (the "vector-only never auto-prices" invariant).
  if (
    decision.status === "needs_confirmation" &&
    risk.kind !== "brand_pinned" &&
    risk.kind !== "cross_class" &&
    candidates[0] != null &&
    shortlist[0] != null &&
    !isVectorOnlyHit(shortlist[0])
  ) {
    const equivalents = buildAvailabilityEquivalents(candidates, item.query ?? "", {
      maxEquivalents: searchConfig?.maxEquivalents ?? 5,
      packTolerance: searchConfig?.packTolerance ?? 0.5,
      penaltyBlock: searchConfig?.penaltyBlockThreshold ?? 1,
      penaltyOf: (id) => gateById.get(id)?.penaltyScore ?? 0,
    });
    if (equivalents.length >= 2) {
      const top = equivalents[0]!;
      return {
        ...base,
        productId: top.productId,
        name: top.name,
        resolvedBy: "query",
        confidence: base.confidence ?? top.score,
        lowConfidence: false,
        resolutionStatus: "resolved",
        equivalents,
      };
    }
  }

  // Auto-resolved commodity: attach an equivalence set so per-chain pricing can
  // use each chain's own equivalent SKU. Produce is fragmented into per-chain
  // non-GTIN product_ids (e.g. 'עגבניות' is 3 single-chain products), so without
  // this an auto-resolved commodity is locked to one chain and coverage never
  // improves — the whole point of per-chain pricing. Unlike the needs_confirmation
  // upgrade above, an auto-resolved line has NO human oversight, and productClass
  // is coarse ('beverage' lumps every red wine together), so we additionally
  // require an equivalent to share the primary's normalized name — genuinely
  // fungible (identical generic produce), never a different wine/brand.
  if (
    decision.status === "resolved" &&
    risk.kind === "commodity" &&
    base.productId != null &&
    shortlist[0] != null &&
    !isVectorOnlyHit(shortlist[0])
  ) {
    const primary = candidates.find((c) => c.productId === base.productId) ?? candidates[0]!;
    const equivalents = buildCommodityEquivalents(
      primary,
      candidates,
      item.query ?? "",
      searchConfig?.maxEquivalents ?? 5,
      searchConfig?.packTolerance ?? 0.5,
    );
    if (equivalents.length >= 2) {
      return { ...base, equivalents };
    }
  }

  // Brand-pin downgrade: a resolved line whose chosen product is NOT the pinned
  // brand must confirm. Brand pinning can only DOWNGRADE, never upgrade. Prefer
  // exact-brand candidates in the returned shortlist so the confirmation offers
  // the brand the user actually asked for.
  if (risk.kind === "brand_pinned" && decision.status === "resolved") {
    const chosenBrand = shortlistBrandById.get(chosen.id) ?? null;
    if (!brandMatches(chosenBrand, risk.pinnedBrand)) {
      const exactBrand = candidates.filter((c) =>
        brandMatches(shortlistBrandById.get(c.productId) ?? null, risk.pinnedBrand),
      );
      const reordered =
        exactBrand.length > 0
          ? [...exactBrand, ...candidates.filter((c) => !exactBrand.includes(c))]
          : candidates;
      return {
        ...base,
        productId: null,
        resolvedBy: "unresolved",
        lowConfidence: true,
        candidates: reordered,
        resolutionStatus: "needs_confirmation",
      };
    }
  }

  return base;
}
