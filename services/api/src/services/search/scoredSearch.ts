import { query } from "@super-mcp/db";
import {
  DEFAULT_SEMANTIC_SEARCH_CONFIG,
  cityMatchKeys,
  expandQueryAliases,
  isDominantPhraseMatch,
  normalizeGtin,
  normalizeEmbedInput,
  tokenizeNormalized,
  type OntologySnapshot,
  type SemanticSearchConfig,
} from "@super-mcp/shared";
import { resolveRadiusKm } from "../../lib/defaults.js";
import {
  semanticBasketEnabled,
  semanticV2RecallEnabled,
  semanticV2Shadow,
} from "../../lib/features.js";
import { mapProduct } from "../products/mapProduct.js";
import type { ProductSummary } from "../products/types.js";
import {
  EXACT_PROBE_CANDIDATE_LIMIT,
  isExactProbeStrong,
  searchExactProducts,
} from "./exactProductSearch.js";
import {
  buildDedupedFromRankedCte,
  buildLexicalRankedCte,
  buildSearchResultsSelect,
} from "./lexicalSql.js";
import { toSearchLocationParams } from "./locationScope.js";
import { getActiveOntology } from "./ontology.js";
import { getQueryEmbedding } from "./queryEmbedding.js";
import { fuseRankedCandidates } from "./rankFusion.js";
import { buildPriceExistsSql, escapeIlike } from "./sqlUtils.js";
import type {
  SearchHitRow,
  SearchPriceExistsOpts,
  SearchProductHit,
  SearchProductsParams,
} from "./types.js";
import { searchByQueryVector } from "./vectorSearch.js";

function phraseMatchesTokens(queryTokens: string[], nameTokens: string[]): boolean {
  if (queryTokens.length === 0 || queryTokens.length > nameTokens.length) return false;
  for (let start = 0; start <= nameTokens.length - queryTokens.length; start++) {
    if (queryTokens.every((token, index) => nameTokens[start + index] === token)) return true;
  }
  return false;
}

function evidenceForQuery(name: string, queryText: string) {
  const queryNormalized = normalizeEmbedInput(queryText);
  const nameNormalized = normalizeEmbedInput(name);
  const queryTokens = tokenizeNormalized(queryNormalized);
  const nameTokens = tokenizeNormalized(nameNormalized);
  const exactName = queryNormalized !== "" && queryNormalized === nameNormalized;
  const exactPhrase = exactName || phraseMatchesTokens(queryTokens, nameTokens);
  return {
    exactName,
    exactPhrase,
    matchedTokenCount: queryTokens.filter((token) => nameTokens.includes(token)).length,
    queryTokenCount: queryTokens.length,
    nameTokenCount: nameTokens.length,
  };
}

function mapSearchHitRow(
  row: SearchHitRow,
  originalQuery: string,
  searchQuery?: string,
): SearchProductHit {
  const lexicalScore = Number(row.score);
  const searched = (searchQuery ?? originalQuery).trim();
  const original = originalQuery.trim() || searched;
  const againstOriginal = evidenceForQuery(row.name, original);
  const againstSearch =
    searched && searched !== original ? evidenceForQuery(row.name, searched) : null;
  const expandedStrong = Boolean(
    againstSearch &&
      (againstSearch.exactName ||
        (againstSearch.exactPhrase &&
          isDominantPhraseMatch(row.name, {
            exactName: againstSearch.exactName,
            exactPhrase: againstSearch.exactPhrase,
            queryTokenCount: againstSearch.queryTokenCount,
          }))),
  );
  return {
    ...mapProduct(row),
    score: lexicalScore,
    matchedVia: expandedStrong ? "alias" : row.matched_via,
    hasPrice: row.has_price,
    hasLocalPrice: row.has_local_price,
    lexicalScore,
    evidence: {
      exactName: againstOriginal.exactName,
      exactPhrase: againstOriginal.exactPhrase,
      matchedTokenCount: againstOriginal.matchedTokenCount,
      queryTokenCount: againstOriginal.queryTokenCount,
      trigramSimilarity: null,
      aliasMatched: row.matched_via === "alias" || expandedStrong,
      vectorDistance: null,
      lexicalScore,
    },
  };
}

function buildSearchScopeParams(
  params: SearchProductsParams,
  candidateLimit: number,
): {
  sqlParams: unknown[];
  scope: SearchPriceExistsOpts & {
    cityParam?: number;
    nearLatParam?: number;
    nearLngParam?: number;
    radiusParam?: number;
    storeIdsParam?: number;
  };
  finalLimit: number;
} {
  const location = toSearchLocationParams(params);
  const q = (params.q ?? "").trim();
  const qLike = escapeIlike(q);
  const gtin = params.gtin?.trim() ? normalizeGtin(params.gtin.trim()) : null;
  const finalLimit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20;
  // Use candidateLimit alone — do not inflate to finalLimit (basket searchLimit is often 60).
  const overFetch = Math.min(Math.max(candidateLimit, 1), 200);
  const radius = resolveRadiusKm(location.near, location.radiusKm);
  const scoped = Boolean(
    location.city || location.near || (location.storeIds && location.storeIds.length > 0),
  );

  const sqlParams: unknown[] = [
    q,
    params.category ?? null,
    params.brand ? escapeIlike(params.brand) : null,
    gtin,
    finalLimit,
    qLike,
    overFetch,
  ];
  let cityParam: number | undefined;
  let nearLatParam: number | undefined;
  let nearLngParam: number | undefined;
  let radiusParam: number | undefined;
  let storeIdsParam: number | undefined;

  if (location.storeIds && location.storeIds.length > 0) {
    sqlParams.push(location.storeIds);
    storeIdsParam = sqlParams.length;
  }
  if (location.city) {
    sqlParams.push(cityMatchKeys(location.city));
    cityParam = sqlParams.length;
  }
  if (location.near && radius != null) {
    sqlParams.push(location.near.lat, location.near.lng, radius);
    nearLatParam = sqlParams.length - 2;
    nearLngParam = sqlParams.length - 1;
    radiusParam = sqlParams.length;
  }

  const localExists = buildPriceExistsSql("r.id", {
    scoped,
    cityParam,
    nearLatParam,
    nearLngParam,
    radiusParam,
    storeIdsParam,
  });
  const globalExists = buildPriceExistsSql("r.id", { scoped: false });
  const stockFilter = params.inStockOnly && scoped ? `AND ${localExists}` : "";

  return {
    sqlParams,
    scope: {
      scoped,
      cityParam,
      nearLatParam,
      nearLngParam,
      radiusParam,
      storeIdsParam,
      localExists,
      globalExists,
      stockFilter,
    },
    finalLimit,
  };
}

/** Keep relevance primary; use stock availability only as a tie-breaker. */
export function orderByLocationStock(
  hits: SearchProductHit[],
  limit: number,
): SearchProductHit[] {
  return [...hits]
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.hasLocalPrice !== b.hasLocalPrice) return a.hasLocalPrice ? -1 : 1;
      if (a.hasPrice !== b.hasPrice) return a.hasPrice ? -1 : 1;
      return a.name.localeCompare(b.name, "en");
    })
    .slice(0, limit);
}

function isLexicalStrong(hit: SearchProductHit | undefined): boolean {
  return Boolean(
    hit &&
      (hit.evidence?.exactName ||
        (hit.evidence?.exactPhrase && isDominantPhraseMatch(hit.name, hit.evidence)) ||
        (hit.evidence?.aliasMatched &&
          (hit.lexicalScore ?? hit.score) >= 0.9 &&
          isDominantPhraseMatch(hit.name, {
            exactName: false,
            exactPhrase: true,
            queryTokenCount: Math.max(1, hit.evidence.queryTokenCount || 1),
          }))),
  );
}

async function searchLexicalOnce(
  params: SearchProductsParams,
  config: SemanticSearchConfig,
  opts?: {
    includeAlias?: boolean;
    includeFuzzy?: boolean;
    /** Default true. First-pass sets false to skip listing ILIKE scan. */
    includeListing?: boolean;
    applyFinalLimit?: boolean;
  },
): Promise<SearchProductHit[]> {
  const includeAlias = opts?.includeAlias !== false;
  const includeFuzzy = opts?.includeFuzzy === true;
  const includeListing = opts?.includeListing !== false;
  const applyFinalLimit = opts?.applyFinalLimit !== false;
  const candidateLimit = config.lexicalLimit;
  const { sqlParams, scope } = buildSearchScopeParams(params, candidateLimit);

  // When feeding RRF, fetch the full lexical candidate pool (limit = overFetch).
  if (!applyFinalLimit) {
    sqlParams[4] = sqlParams[6];
  }

  const sql = `
    WITH ${buildLexicalRankedCte({
      includeAliasHit: includeAlias,
      includeFuzzy,
      includeListing,
      trigramThreshold: config.trigramThreshold,
    })}
    ${buildDedupedFromRankedCte()}
    ${buildSearchResultsSelect(
      scope.localExists,
      scope.globalExists,
      scope.scoped,
      scope.stockFilter,
      { orderByStock: applyFinalLimit },
    )}`;

  try {
    const res = await query<SearchHitRow>(sql, sqlParams);
    // Always score evidence against the original user query, even when this
    // pass searched an expanded alias variant (e.g. בצלים → בצל).
    const evidenceQuery = params.originalQuery ?? params.q ?? "";
    const searchQuery = params.q ?? evidenceQuery;
    const hits = res.rows.map((row) => mapSearchHitRow(row, evidenceQuery, searchQuery));
    return applyFinalLimit ? hits : hits.slice(0, candidateLimit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!includeAlias || !/product_alias/i.test(message)) throw err;
    return searchLexicalOnce(params, config, {
      includeAlias: false,
      includeFuzzy,
      includeListing,
      applyFinalLimit,
    });
  }
}

function lexicalHitQuality(hit: SearchProductHit): number {
  if (hit.evidence?.exactName) return 5;
  if (hit.evidence?.aliasMatched && hit.matchedVia !== "listing") return 4;
  if (
    hit.evidence?.exactPhrase &&
    isDominantPhraseMatch(hit.name, hit.evidence)
  ) {
    return 3;
  }
  if (hit.matchedVia === "product" || hit.matchedVia === "gtin") return 2;
  if (hit.matchedVia === "alias") return 1;
  return 0;
}

function mergeLexicalHits(lists: SearchProductHit[], limit: number): SearchProductHit[] {
  const byId = new Map<string, SearchProductHit>();
  for (const hit of lists) {
    const prev = byId.get(hit.id);
    const score = hit.lexicalScore ?? hit.score;
    const prevScore = prev ? (prev.lexicalScore ?? prev.score) : -1;
    if (
      !prev ||
      score > prevScore ||
      (score === prevScore && lexicalHitQuality(hit) > lexicalHitQuality(prev))
    ) {
      byId.set(hit.id, hit);
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        (b.lexicalScore ?? b.score) - (a.lexicalScore ?? a.score) ||
        lexicalHitQuality(b) - lexicalHitQuality(a) ||
        a.name.localeCompare(b.name, "he"),
    )
    .slice(0, limit);
}

async function searchLexical(
  params: SearchProductsParams,
  config: SemanticSearchConfig,
  opts?: {
    includeAlias?: boolean;
    includeFuzzy?: boolean;
    includeListing?: boolean;
    applyFinalLimit?: boolean;
    ontology?: OntologySnapshot | null;
  },
): Promise<SearchProductHit[]> {
  const applyFinalLimit = opts?.applyFinalLimit !== false;
  const includeFuzzy = opts?.includeFuzzy === true;
  const includeListing = opts?.includeListing !== false;
  const candidateLimit = config.lexicalLimit;
  const originalQuery = (params.originalQuery ?? params.q ?? "").trim();
  const variants = opts?.ontology
    ? expandQueryAliases(originalQuery, opts.ontology, 4)
    : [originalQuery];
  const unique = [...new Set(variants.map((v) => v.trim()).filter(Boolean))];
  const primary = await searchLexicalOnce(
    { ...params, q: originalQuery || params.q, originalQuery },
    config,
    {
      includeAlias: opts?.includeAlias,
      includeFuzzy,
      includeListing,
      applyFinalLimit: false,
    },
  );
  const primaryTop = primary[0];
  const primaryStrong = Boolean(
    primaryTop &&
      (primaryTop.evidence?.exactName ||
        (primaryTop.evidence?.exactPhrase &&
          isDominantPhraseMatch(primaryTop.name, primaryTop.evidence))),
  );
  // If the original query already has a dominant exact hit, skip alias expansion
  // (expansion to singular forms can surface junk listing collisions).
  if (unique.length <= 1 || primaryStrong) {
    const limited = primary.slice(0, candidateLimit);
    return applyFinalLimit
      ? orderByLocationStock(
          limited,
          params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20,
        )
      : limited;
  }

  const expanded = unique.filter((q) => q !== originalQuery);
  const lists = await Promise.all(
    expanded.map((q) =>
      searchLexicalOnce({ ...params, q, originalQuery }, config, {
        includeAlias: opts?.includeAlias,
        includeFuzzy,
        includeListing,
        applyFinalLimit: false,
      }),
    ),
  );
  const merged = mergeLexicalHits([primary, ...lists].flat(), candidateLimit);
  return applyFinalLimit
    ? orderByLocationStock(
        merged,
        params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20,
      )
    : merged;
}

async function tryExactProbe(
  params: SearchProductsParams,
  config: SemanticSearchConfig,
): Promise<SearchProductHit[] | null> {
  const q = (params.q ?? "").trim();
  if (!q && !params.gtin?.trim()) return null;

  const rows = await searchExactProducts(params, EXACT_PROBE_CANDIDATE_LIMIT);
  if (rows.length === 0) return null;

  const evidenceQuery = params.originalQuery ?? params.q ?? "";
  const searchQuery = params.q ?? evidenceQuery;
  const hits = rows.map((row) => mapSearchHitRow(row, evidenceQuery, searchQuery));
  return isExactProbeStrong(hits, config) ? hits : null;
}

/**
 * Hebrew/English search over product + chain listing names.
 * Prefers products that currently have store prices; returns a relevance score for confidence gating.
 * With city/near/storeIds, has_price / ranking prefer locally stocked SKUs.
 *
 * When semantic expand is on: lexical + direct query-vector ANN, fused with weighted RRF.
 */
export async function searchProductsScored(params: SearchProductsParams): Promise<SearchProductHit[]> {
  const semanticExpand =
    params.semanticExpand !== undefined
      ? params.semanticExpand
      : semanticBasketEnabled() && semanticV2RecallEnabled();

  const q = (params.q ?? "").trim();
  let config = DEFAULT_SEMANTIC_SEARCH_CONFIG;
  const ontology = semanticExpand ? await getActiveOntology() : null;
  if (ontology?.searchConfig) config = ontology.searchConfig;

  const finalLimit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20;
  const started = Date.now();

  // Fail-fast product-only probe (no listing CTE, no trigram %).
  const exactHits = await tryExactProbe(params, config);
  // A generic commodity term ("חומוס") exact-matches a swarm of single-chain orphan
  // SKUs that nobody nearby stocks, while the widely-carried product ("חומוס מסעדות
  // צבר") is not an exact-name match and never enters the probe. When the request is
  // location-scoped and NOT ONE exact hit is locally available, don't accept the
  // probe — fall through to the lexical/listing search that surfaces the products
  // stores actually carry. This is safe now that basket resolution classifies
  // candidates: the wider pool (e.g. roasted-chickpea "חומוס קלוי") is separated by
  // its class label, so it can't be mistaken for the spread. Unscoped, or when any
  // exact hit is local, the fast path stands.
  const locationScoped = Boolean(
    params.city || params.near || (params.storeIds && params.storeIds.length > 0),
  );
  const exactProbeUsable =
    exactHits != null && !(locationScoped && exactHits.every((h) => !h.hasLocalPrice));
  if (exactHits && exactProbeUsable) {
    console.log(
      JSON.stringify({
        event: "semantic_search",
        model: null,
        ontologyVersion: ontology?.version ?? null,
        queryCacheHit: false,
        lexicalCandidates: exactHits.length,
        vectorCandidates: 0,
        fusedCandidates: 0,
        profileCoverage: null,
        fallbackReason: null,
        path: "exact_probe",
        durationMs: Date.now() - started,
      }),
    );
    return orderByLocationStock(exactHits, finalLimit);
  }

  // Ontology unavailable → lexical-only (no vector config / RRF).
  if (!semanticExpand || !q || !ontology) {
    if (semanticExpand && q && !ontology) {
      console.warn(
        JSON.stringify({
          event: "semantic_search",
          model: null,
          ontologyVersion: null,
          queryCacheHit: false,
          lexicalCandidates: null,
          vectorCandidates: 0,
          fusedCandidates: 0,
          profileCoverage: null,
          fallbackReason: "ontology_unavailable",
          path: "lexical_only",
          durationMs: Date.now() - started,
        }),
      );
    }
    return searchLexical(params, config, {
      applyFinalLimit: true,
      includeFuzzy: true,
      ontology,
    });
  }

  const firstPassConfig = {
    ...config,
    lexicalLimit: config.firstPassLexicalLimit || 20,
  };
  // First pass: product + alias only (skip listing ILIKE scan).
  let lexical = await searchLexical(params, firstPassConfig, {
    applyFinalLimit: false,
    includeFuzzy: false,
    includeListing: false,
    ontology,
  });
  if (isLexicalStrong(lexical[0])) {
    console.log(
      JSON.stringify({
        event: "semantic_search",
        model: null,
        ontologyVersion: ontology.version,
        queryCacheHit: false,
        lexicalCandidates: lexical.length,
        vectorCandidates: 0,
        fusedCandidates: 0,
        profileCoverage: null,
        fallbackReason: null,
        path: "deterministic_only",
        durationMs: Date.now() - started,
      }),
    );
    return orderByLocationStock(lexical, finalLimit);
  }

  // Weak first pass → fuzzy lexical WITH listing (full candidate limit) before / with vector.
  const fuzzyLexical = await searchLexical(params, config, {
    applyFinalLimit: false,
    includeFuzzy: true,
    includeListing: true,
    ontology,
  });
  lexical = mergeLexicalHits([...lexical, ...fuzzyLexical], config.lexicalLimit);
  if (isLexicalStrong(lexical[0])) {
    console.log(
      JSON.stringify({
        event: "semantic_search",
        model: null,
        ontologyVersion: ontology.version,
        queryCacheHit: false,
        lexicalCandidates: lexical.length,
        vectorCandidates: 0,
        fusedCandidates: 0,
        profileCoverage: null,
        fallbackReason: null,
        path: "deterministic_only",
        durationMs: Date.now() - started,
      }),
    );
    return orderByLocationStock(lexical, finalLimit);
  }

  const embeddingOutcome = await getQueryEmbedding(q)
    .then((value) => ({ ok: true as const, value }))
    .catch((err: unknown) => ({ ok: false as const, err }));

  if (!embeddingOutcome.ok) {
    console.warn(
      JSON.stringify({
        event: "semantic_search",
        model: null,
        ontologyVersion: ontology?.version ?? null,
        queryCacheHit: false,
        lexicalCandidates: lexical.length,
        vectorCandidates: 0,
        fusedCandidates: 0,
        profileCoverage: null,
        fallbackReason: "query_embed_failed",
        path: "lexical_only",
        durationMs: Date.now() - started,
      }),
    );
    return orderByLocationStock(lexical, finalLimit);
  }

  let vectorHits: SearchProductHit[] = [];
  try {
    vectorHits = await searchByQueryVector({
      vector: embeddingOutcome.value.vector,
      model: embeddingOutcome.value.model,
      limit: config.embeddingFallbackLimit || 15,
      maxDistance: config.vectorDistanceMax,
      params,
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "semantic_search",
        model: embeddingOutcome.value.model,
        ontologyVersion: ontology?.version ?? null,
        queryCacheHit: embeddingOutcome.value.cacheHit,
        lexicalCandidates: lexical.length,
        vectorCandidates: 0,
        fusedCandidates: 0,
        profileCoverage: null,
        fallbackReason: "vector_search_failed",
        path: "lexical_only",
        durationMs: Date.now() - started,
      }),
    );
    return orderByLocationStock(lexical, finalLimit);
  }

  const fused = fuseRankedCandidates(lexical, vectorHits, config).map(
    ({ lexicalRank: _lr, vectorRank: _vr, fusedScore: _fs, ...hit }) => hit,
  );
  const shadow = semanticV2Shadow();
  const orderedLexical = orderByLocationStock(lexical, finalLimit);
  const orderedFused = orderByLocationStock(fused, finalLimit);
  const lexicalTopId = orderedLexical[0]?.id ?? null;
  const fusedTop = orderedFused[0]?.id ?? null;
  console.log(
    JSON.stringify({
      event: "semantic_search",
      model: embeddingOutcome.value.model,
      ontologyVersion: ontology?.version ?? null,
      queryCacheHit: embeddingOutcome.value.cacheHit,
      lexicalCandidates: lexical.length,
      vectorCandidates: vectorHits.length,
      fusedCandidates: fused.length,
      profileCoverage: null,
      fallbackReason: shadow ? "v2_shadow_return_lexical" : null,
      path: shadow ? "hybrid_shadow" : "hybrid_fallback",
      shadowDisagree: shadow && lexicalTopId != null && fusedTop != null && lexicalTopId !== fusedTop,
      durationMs: Date.now() - started,
    }),
  );
  // Shadow: compute V2 fusion for observability but return lexical ordering.
  return shadow ? orderedLexical : orderedFused;
}

/** Convenience wrapper keeping the historical ProductSummary[] return shape. */
export async function searchProducts(params: SearchProductsParams): Promise<ProductSummary[]> {
  const hits = await searchProductsScored(params);
  return hits.map((hit) => ({
    id: hit.id,
    gtin: hit.gtin,
    name: hit.name,
    brand: hit.brand,
    categoryL1: hit.categoryL1,
    categoryL2: hit.categoryL2,
    sizeQty: hit.sizeQty,
    sizeUnit: hit.sizeUnit,
  }));
}
