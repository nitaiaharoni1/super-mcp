/**
 * Product-only exact/prefix probe — no listing CTE, no trigram `%`.
 * Used as the first retrieval stage before candidate-first lexical search.
 */
import { query } from "@super-mcp/db";
import {
  cityMatchKeys,
  isDominantPhraseMatch,
  normalizeGtin,
  type SemanticSearchConfig,
} from "@super-mcp/shared";
import { resolveRadiusKm } from "../../lib/defaults.js";
import { buildDedupedFromRankedCte, buildSearchResultsSelect } from "./lexicalSql.js";
import { toSearchLocationParams } from "./locationScope.js";
import { buildPriceExistsSql, escapeIlike } from "./sqlUtils.js";
import type {
  SearchHitRow,
  SearchPriceExistsOpts,
  SearchProductHit,
  SearchProductsParams,
} from "./types.js";

/** Adaptive probe size: small pool for exact/dominant hits. */
export const EXACT_PROBE_CANDIDATE_LIMIT = 10;

/**
 * Ranked CTE over `product` only: exact name, FTS, prefix/containment, GTIN.
 * Candidate-first UNION (no listing joins, no trigram `p.name % $1`).
 */
export function buildExactProductRankedCte(): string {
  return `
    candidates AS (
      SELECT p.id AS product_id
      FROM product p
      WHERE $1 = ''
      UNION
      SELECT p.id AS product_id
      FROM product p
      WHERE $1 <> ''
        AND p.search_vector @@ websearch_to_tsquery('simple', $1)
      UNION
      SELECT p.id AS product_id
      FROM product p
      WHERE $1 <> ''
        AND p.name ILIKE $6 || '%' ESCAPE '\\'
      UNION
      SELECT p.id AS product_id
      FROM product p
      WHERE $1 <> ''
        AND p.name ILIKE '%' || $6 || '%' ESCAPE '\\'
      UNION
      SELECT p.id AS product_id
      FROM product p
      WHERE $4::text IS NOT NULL
        AND p.gtin = $4
    ),
    ranked AS (
      SELECT p.id, p.gtin, p.name, p.brand, p.category_l1, p.category_l2, p.size_qty, p.size_unit,
             CASE
               WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 1.0
               WHEN $1 <> '' AND lower(p.name) = lower($1) THEN 1.0
               WHEN $1 <> '' AND p.name ILIKE $6 || '%' ESCAPE '\\' THEN 0.95
               WHEN $1 <> '' AND (
                 p.name ILIKE $6 || ' %' ESCAPE '\\'
                 OR p.name ILIKE '% ' || $6 ESCAPE '\\'
                 OR p.name ILIKE '% ' || $6 || ' %' ESCAPE '\\'
               ) THEN 0.9
               WHEN $1 <> '' AND p.search_vector @@ websearch_to_tsquery('simple', $1) THEN 0.85
               WHEN $1 <> '' AND p.name ILIKE '%' || $6 || '%' ESCAPE '\\' THEN 0.78
               ELSE 0
             END AS score,
             CASE
               WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 'gtin'
               ELSE 'product'
             END AS matched_via
      FROM candidates c
      JOIN product p ON p.id = c.product_id
      WHERE ($2::text IS NULL OR p.category_l1 = $2 OR p.category_l2 = $2)
        AND ($3::text IS NULL OR p.brand ILIKE '%' || $3 || '%' ESCAPE '\\')
        AND ($4::text IS NULL OR p.gtin = $4)
      ORDER BY score DESC, p.name ASC
      LIMIT $7
    )`;
}

function buildExactProbeScope(
  params: SearchProductsParams,
  candidateLimit: number,
): {
  sqlParams: unknown[];
  scope: SearchPriceExistsOpts;
} {
  const location = toSearchLocationParams(params);
  const q = (params.q ?? "").trim();
  const qLike = escapeIlike(q);
  const gtin = params.gtin?.trim() ? normalizeGtin(params.gtin.trim()) : null;
  const finalLimit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20;
  const overFetch = Math.min(candidateLimit, 200);
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
  };
}

/** Full exact-probe SQL (CTE + price flags). Useful for unit assertions. */
export function buildExactProductSearchSql(
  localExists: string,
  globalExists: string,
  scoped: boolean,
  stockFilter: string,
): string {
  return `
    WITH ${buildExactProductRankedCte()}
    ${buildDedupedFromRankedCte()}
    ${buildSearchResultsSelect(localExists, globalExists, scoped, stockFilter, {
      orderByStock: false,
    })}`;
}

/**
 * Run the product-only exact/prefix probe.
 * Returns raw hit rows; caller maps evidence against the original query.
 */
export async function searchExactProducts(
  params: SearchProductsParams,
  candidateLimit = EXACT_PROBE_CANDIDATE_LIMIT,
): Promise<SearchHitRow[]> {
  const q = (params.q ?? "").trim();
  if (!q && !params.gtin?.trim()) return [];

  const { sqlParams, scope } = buildExactProbeScope(params, candidateLimit);
  // Outer LIMIT matches candidate pool (probe does not apply client finalLimit here).
  sqlParams[4] = sqlParams[6];

  const sql = buildExactProductSearchSql(
    scope.localExists,
    scope.globalExists,
    scope.scoped,
    scope.stockFilter,
  );
  const res = await query<SearchHitRow>(sql, sqlParams);
  return res.rows;
}

/**
 * True when the probe is strong enough to skip listing/fuzzy lexical.
 * Exact name always qualifies (multiple IDs remain candidates).
 * Short dominant prefix qualifies only with score ≥ strongLexicalThreshold and gap.
 */
export function isExactProbeStrong(
  hits: SearchProductHit[],
  config: SemanticSearchConfig,
): boolean {
  const top = hits[0];
  if (!top) return false;
  if (top.evidence?.exactName) return true;

  const score = top.lexicalScore ?? top.score;
  if (score < config.strongLexicalThreshold) return false;
  if (
    !(
      top.evidence?.exactPhrase &&
      isDominantPhraseMatch(top.name, top.evidence) &&
      score >= 0.95
    )
  ) {
    return false;
  }

  const second = hits[1];
  if (!second) return true;
  const secondScore = second.lexicalScore ?? second.score;
  return score - secondScore >= config.autoAcceptGap;
}
