import {
  buildQueryProfile,
  DEFAULT_SEMANTIC_SEARCH_CONFIG,
  inferPackSizeFromName,
  normalizeEmbedInput,
  normalizeMeasure,
  profileFromText,
  rankDeterministicCandidates,
  resolvePurchaseQty,
  tokenizeNormalized,
  type OntologySnapshot,
  type QueryProfile,
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
  isStapleIncompatible,
  preferQueryHeadAnchored,
  queryHeadAnchored,
} from "./equivalence.js";
import { brandMatches, classifyLineRisk, type RiskCandidate } from "./lineRisk.js";
import { decideResolution } from "./resolutionDecision.js";
import { assertPurchaseQtyPreservesRequest } from "./purchaseQtyGuard.js";
import type { QueryResolveResult, QuerySearchContext } from "./resolveQuery.js";
import type { BasketCandidate, BasketSubstitutionMeta } from "./types.js";
import { isVectorOnly } from "./vectorOnly.js";
import {
  chickenNameIsUndesired,
  rejectUnsafeChickenName,
} from "./chickenSafety.js";
import {
  plainMilkNameIsUndesired,
  rejectUnsafePlainMilkName,
} from "./milkSafety.js";

export { chickenNameIsUndesired } from "./chickenSafety.js";
export { plainMilkNameIsUndesired } from "./milkSafety.js";

/** Drop organ/processed chicken and specialty milk traps for staple queries. */
function rejectUnsafeStapleName(queryText: string, candidateName: string): boolean {
  return (
    rejectUnsafeChickenName(queryText, candidateName) ||
    rejectUnsafePlainMilkName(queryText, candidateName)
  );
}

export interface SafePrimaryInput {
  query: string;
  profile: QueryProfile;
  candidates: BasketCandidate[];
}

/** True when candidate variant satisfies an explicit query variant (diet↔diet_zero). */
function variantMatchesWanted(wanted: string, got: string): boolean {
  const dietWanted = wanted === "diet" || wanted === "diet_zero";
  const dietGot = got === "diet_zero" || got === "diet";
  if (dietWanted) return dietGot;
  return got === wanted;
}

/** Candidates compatible with hard query intent (form, pack, domain, brand). */
export function filterSafeCandidates(input: SafePrimaryInput): BasketCandidate[] {
  const { query, profile, candidates } = input;
  const pieceCountRaw = profile.attributes.piece_count;
  const pieceCount =
    pieceCountRaw != null && pieceCountRaw !== ""
      ? Number(pieceCountRaw)
      : null;
  const requireFreshProduce = profile.attributes.form === "fresh";
  const brandWanted = profile.attributes.brand ?? null;
  const variantWanted = profile.attributes.variant ?? null;

  return candidates.filter((c) => {
    if (
      isStapleIncompatible(query, c, {
        requireFreshProduce,
        pieceCount: pieceCount != null && Number.isFinite(pieceCount) ? pieceCount : null,
        requestedAmount: profile.requestedAmount,
      })
    ) {
      return false;
    }
    // Explicit variant intent: reject regular and unlabeled peers (organic≠regular).
    if (variantWanted) {
      const got = c.variant ?? null;
      if (!got || got === "regular") return false;
      if (!variantMatchesWanted(variantWanted, got)) return false;
    }
    // Explicit brand intent: reject labeled conflicts (catalog brand or brand_extracted).
    if (brandWanted) {
      const candidateBrand = c.brandExtracted ?? null;
      if (candidateBrand && !brandMatches(candidateBrand, brandWanted)) return false;
    }
    return true;
  });
}

/**
 * Pick the first candidate compatible with hard query intent (fresh produce,
 * pack count/volume, food vs personal-care). Unsafe peers are excluded so the
 * same primary drives name, productId, equivalence, and question options.
 */
export function selectSafePrimary(input: SafePrimaryInput): BasketCandidate | null {
  return filterSafeCandidates(input)[0] ?? null;
}

const EMPTY_FAST_AVAILABILITY = {
  pricedStoreCount: 0,
  chainCount: 0,
  minPrice: null as number | null,
};

/**
 * Preference order for fast best-effort selection among already-safe candidates:
 * local price → regular/default → pack match → score → store/chain coverage.
 */
export function rankSafeCandidatesForFast(
  candidates: BasketCandidate[],
  availability: Map<
    string,
    { pricedStoreCount: number; chainCount: number; minPrice: number | null }
  >,
  profile: QueryProfile,
  opts?: { preferCanola?: boolean; preferPlainMilk?: boolean; preferFreshChicken?: boolean },
): BasketCandidate[] {
  const pieceWanted =
    profile.attributes.piece_count != null ? Number(profile.attributes.piece_count) : null;
  const amountWanted = profile.requestedAmount;
  const queryTokens = tokenizeNormalized(profile.normalizedText);

  const packScore = (c: BasketCandidate): number => {
    if (pieceWanted != null && Number.isFinite(pieceWanted)) {
      return c.pieceCount === pieceWanted ? 1 : 0;
    }
    if (!amountWanted || c.sizeQty == null || !c.sizeUnit) return 0;
    const unit = amountWanted.unit.trim().toLowerCase();
    const cUnit = c.sizeUnit.trim().toLowerCase();
    if (unit !== cUnit && !(unit === "l" && (cUnit === "l" || cUnit === "ליטר"))) return 0;
    return Math.abs(c.sizeQty - amountWanted.quantity) < 1e-6 ? 1 : 0;
  };

  const isLocal = (c: BasketCandidate): boolean => {
    if (c.hasLocalPrice) return true;
    return (availability.get(c.productId) ?? EMPTY_FAST_AVAILABILITY).pricedStoreCount > 0;
  };

  const isRegular = (c: BasketCandidate): boolean =>
    c.variant == null || c.variant === "regular";

  return [...candidates].sort((a, b) => {
    const localDiff = Number(isLocal(b)) - Number(isLocal(a));
    if (localDiff !== 0) return localDiff;

    const regDiff = Number(isRegular(b)) - Number(isRegular(a));
    if (regDiff !== 0) return regDiff;

    const packDiff = packScore(b) - packScore(a);
    if (packDiff !== 0) return packDiff;

    if (opts?.preferCanola) {
      const aCanola = Number(normalizeEmbedInput(a.name).includes("קנולה"));
      const bCanola = Number(normalizeEmbedInput(b.name).includes("קנולה"));
      if (bCanola !== aCanola) return bCanola - aCanola;
    }
    if (opts?.preferPlainMilk) {
      const aPlain = Number(isRegular(a) && !plainMilkNameIsUndesired(a.name, queryTokens));
      const bPlain = Number(isRegular(b) && !plainMilkNameIsUndesired(b.name, queryTokens));
      if (bPlain !== aPlain) return bPlain - aPlain;
    }
    if (opts?.preferFreshChicken) {
      const aFresh = Number(!chickenNameIsUndesired(a.name, queryTokens));
      const bFresh = Number(!chickenNameIsUndesired(b.name, queryTokens));
      if (bFresh !== aFresh) return bFresh - aFresh;
    }

    if (b.score !== a.score) return b.score - a.score;

    const aCov = (availability.get(a.productId) ?? EMPTY_FAST_AVAILABILITY).pricedStoreCount;
    const bCov = (availability.get(b.productId) ?? EMPTY_FAST_AVAILABILITY).pricedStoreCount;
    if (bCov !== aCov) return bCov - aCov;

    const aChains = (availability.get(a.productId) ?? EMPTY_FAST_AVAILABILITY).chainCount;
    const bChains = (availability.get(b.productId) ?? EMPTY_FAST_AVAILABILITY).chainCount;
    if (bChains !== aChains) return bChains - aChains;

    return a.productId.localeCompare(b.productId);
  });
}

function emptyQueryProfile(query: string): QueryProfile {
  return {
    normalizedText: normalizeEmbedInput(query),
    coreTerms: [],
    category: null,
    attributes: {},
    requestedAmount: null,
  };
}

/**
 * Single-token spirits/beer generics that must not auto-resolve via commodity
 * override (variety/brand is the decision). Bare "יין" is intentionally excluded:
 * when the user does not name a variety, pick a good-enough locally-stocked bottle
 * via commodity/availability equivalence (cheapest red/white among peers).
 */
const BARE_ALCOHOL_QUERY_TOKENS: ReadonlySet<string> = new Set([
  "בירה",
  "וודקה",
  "וויסקי",
  "ויסקי",
  "רום",
  "גין",
]);

function strongPool(candidates: BasketCandidate[]): BasketCandidate[] {
  const strong = candidates.filter(
    (c) => c.intentTier != null && c.intentTier >= 1 && c.intentTier <= 2,
  );
  return strong.length > 0 ? strong : candidates;
}

/**
 * Override safety: strong shortlist members must not disagree on classL1 (or on
 * flat productClass when L1 is absent). A lone labeled class among unlabeled
 * peers is fine; two distinct L1s (soda vs candy, produce vs bakery) is not.
 */
function strongCandidatesShareClass(candidates: BasketCandidate[]): boolean {
  const pool = strongPool(candidates);
  const l1 = [
    ...new Set(pool.map((c) => c.classL1).filter((x): x is string => x != null && x !== "")),
  ];
  if (l1.length > 1) return false;
  if (l1.length === 1) return true;
  const flat = [
    ...new Set(pool.map((c) => c.productClass).filter((x): x is string => x != null && x !== "")),
  ];
  return flat.length <= 1;
}

/** Bare category alcohol queries ("יין", "בירה") — variety is the decision. */
function isBareAlcoholGeneric(queryText: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (tokens.length !== 1) return false;
  return BARE_ALCOHOL_QUERY_TOKENS.has(tokens[0]!);
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
      packQty: item.packQty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: hit.sizeQty,
      productSizeUnit: hit.sizeUnit,
      productName: hit.name,
      pieceCount: hit.pieceCount,
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
  let queryProfile: QueryProfile = emptyQueryProfile(item.query ?? "");

  if (ontology) {
    const rankStarted = Date.now();
    queryProfile = buildQueryProfile(item.query!, ontology, {
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
  const shortlistRaw = ranked.slice(0, shortlistCap);
  if (wantsPackSize) {
    const seen = new Set(shortlistRaw.map((hit) => hit.id));
    for (const hit of ranked) {
      if (shortlistRaw.length >= shortlistCap + 3) break;
      if (seen.has(hit.id) || purchaseFor(hit).mode !== "packs") continue;
      shortlistRaw.push(hit);
      seen.add(hit.id);
    }
  }
  // Utensil/opener leaders ("חולץ יין") often share a token with the commodity
  // and can outrank real bottles on lexical score + local stock. Keep them in
  // the shortlist for transparency, but never ahead of head-anchored products.
  const shortlist = preferQueryHeadAnchored(item.query ?? "", shortlistRaw);

  // Hard intent first: exclude traps before decideResolution / display primary.
  // When nothing is safe, keep the empty list (do NOT re-admit unsafe candidates).
  const rankedCandidates: BasketCandidate[] = shortlist.map((hit) =>
    hitToCandidate(hit, productClassFor(hit), classMap?.get(hit.id)),
  );
  const candidates = filterSafeCandidates({
    query: item.query ?? "",
    profile: queryProfile,
    candidates: rankedCandidates,
  });
  const safeHits = candidates.flatMap((c) => {
    const hit = shortlist.find((h) => h.id === c.productId);
    return hit ? [hit] : [];
  });

  let decision = decideResolution(
    item.query ?? "",
    safeHits.map((hit) => ({
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
  let chosen = decision.productId
    ? (safeHits.find((hit) => hit.id === decision.productId) ?? safeHits[0])
    : safeHits[0];
  // Modifier-trap guard at the DECISION level (covers the normal auto-resolve
  // path, not just the needs_confirmation overrides): a strong lexical/name match
  // can still resolve a line to a product where the query word is a trailing
  // MODIFIER — "שמן" (oil) → "עגבניות מיובשות שמן" (sun-dried tomatoes in oil),
  // "סבון" (soap) → "משחק בועות סבון" (a bubble toy). If the pick isn't
  // head-anchored, drop to needs_confirmation so the user decides.
  if (
    decision.status === "resolved" &&
    chosen &&
    item.query &&
    !queryHeadAnchored(item.query, chosen.name)
  ) {
    decision = {
      status: "needs_confirmation",
      productId: null,
      name: null,
      confidenceLabel: null,
      confidence: null,
      lowConfidence: true,
      autoPrice: false,
    };
  }

  if (!chosen) {
    return {
      qty: item.packQty ?? item.amount ?? 1,
      qtyMode: "packs",
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
    packQty: item.packQty,
    amount: item.amount,
    unit: item.unit,
    productSizeQty: chosen.sizeQty,
    productSizeUnit: chosen.sizeUnit,
    productName: chosen.name,
    pieceCount: chosen.pieceCount,
  });
  assertPurchaseQtyPreservesRequest(item, purchase);

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

  // BasketCandidate drops brand; the risk classifier needs it, so keep the raw
  // hit brand keyed by product id. NOTE: we deliberately do NOT fall back to the
  // LLM brand_extracted here. The commodity+variant+query-token path already pins
  // a brand query (query tokens must appear in the equivalent's name) AND keeps
  // it regular (variant), which is strictly better than a brand-pin
  // downgrade — routing more lines through brand-pin regressed cola→diet and cut
  // auto-resolve 16→13/18. brand_extracted stays stored for future use.
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
  //
  // Score risk only on head-anchored candidates. Live shortlists often mix the
  // commodity (יין אדום …) with utensil/host leaders (חולץ יין, עוגת לימונים)
  // that share a token but a different classL1 — that must not invent a
  // cross_class confirmation when the anchored pool is a clean commodity.
  const queryText = item.query ?? "";
  const anchoredCandidates = candidates.filter((c) =>
    queryHeadAnchored(queryText, c.name),
  );
  const riskPool = anchoredCandidates.length > 0 ? anchoredCandidates : candidates;
  const risk = classifyLineRisk(
    queryText,
    riskPool.map(
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
  // Also skip when strong candidates disagree on classL1/productClass (even if
  // risk still says commodity), and for bare single-token alcohol generics.
  // Uses the query-token-safe builder so a brand/variety query (טסטרס צ'ויס)
  // never groups a different brand of the same class (עלית צ'יקו).
  const overrideSafe =
    strongCandidatesShareClass(riskPool) && !isBareAlcoholGeneric(queryText);
  if (
    decision.status === "needs_confirmation" &&
    risk.kind === "commodity" &&
    overrideSafe &&
    candidates[0] != null &&
    !isVectorOnly(chosen)
  ) {
    const stapleSafe = candidates.filter((c) => !rejectUnsafeStapleName(queryText, c.name));
    const top = stapleSafe.find((c) => queryHeadAnchored(queryText, c.name));
    if (top) {
      const equivalents = buildCommodityEquivalents(
        top,
        stapleSafe,
        queryText,
        searchConfig?.maxEquivalents ?? 5,
        searchConfig?.packTolerance ?? 0.5,
      );
      if (equivalents.length >= 2) {
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
  }

  // Availability commodity override: the class-gated branch above can't fire for
  // the ~95% of the catalog with NO product_class (risk === "opaque"), so a
  // generic staple every store stocks (חומוס, טחינה, מלח גס, אבטיח) was forced
  // to a needless question. When ≥2 locally-available, query-safe, non-penalized
  // products share a unit, auto-resolve to that group and let per-chain pricing
  // pick the cheapest — availability + query specificity stand in for the missing
  // class signal. Never fires for brand_pinned (respect the named brand) or
  // cross_class (a genuine either/or the user must decide), nor for a vector-only
  // top pick (the "vector-only never auto-prices" invariant), nor when strong
  // candidates conflict on class or the query is a bare alcohol generic.
  if (
    decision.status === "needs_confirmation" &&
    risk.kind !== "brand_pinned" &&
    risk.kind !== "cross_class" &&
    overrideSafe &&
    candidates[0] != null &&
    !isVectorOnly(chosen)
  ) {
    const equivalents = buildAvailabilityEquivalents(candidates, queryText, {
      maxEquivalents: searchConfig?.maxEquivalents ?? 5,
      packTolerance: searchConfig?.packTolerance ?? 0.5,
      penaltyBlock: searchConfig?.penaltyBlockThreshold ?? 1,
      penaltyOf: (id) => gateById.get(id)?.penaltyScore ?? 0,
    });
    if (
      equivalents.length >= 2 &&
      queryHeadAnchored(queryText, equivalents[0]!.name) &&
      !rejectUnsafeStapleName(queryText, equivalents[0]!.name)
    ) {
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
    !isVectorOnly(chosen)
  ) {
    const primary = candidates.find((c) => c.productId === base.productId) ?? candidates[0]!;
    const queryForEq = item.query ?? "";
    const stapleSafe = candidates.filter((c) => !rejectUnsafeStapleName(queryForEq, c.name));
    if (!rejectUnsafeStapleName(queryForEq, primary.name)) {
      const equivalents = buildCommodityEquivalents(
        primary,
        stapleSafe,
        queryForEq,
        searchConfig?.maxEquivalents ?? 5,
        searchConfig?.packTolerance ?? 0.5,
      );
      if (equivalents.length >= 2) {
        return { ...base, equivalents };
      }
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
