/** Shared lexical ranking CTE used by hybrid and fallback search. */

export type LexicalRankedCteOptions = {
  /** Include product_alias candidate + score branch. Default false. */
  includeAliasHit?: boolean;
  /**
   * Include trigram fuzzy candidate branch (`p.name % $1`).
   * Default false — first-pass indexed retrieval; enable only on fallback.
   */
  includeFuzzy?: boolean;
  /**
   * Include listing_hit evidence CTE + candidate UNION branch + listing score arms.
   * Default true for backward compat. Set false on first-pass to skip listing ILIKE scan.
   */
  includeListing?: boolean;
  /** Threshold for alias trigram similarity when includeFuzzy is on. */
  trigramThreshold?: number;
};

/**
 * Indexed product-side candidate branches (UNION'd) before join/score.
 * Listing/alias IDs are union'd separately from their evidence CTEs.
 */
export function buildLexicalCandidateUnionSql(options: LexicalRankedCteOptions = {}): string {
  const includeAliasHit = options.includeAliasHit === true;
  const includeFuzzy = options.includeFuzzy === true;
  const includeListing = options.includeListing !== false;

  // Note: avoid `lower(p.name) = lower($1)` as a retrieval branch — it
  // parallel-seq-scans the product table. Exact names are retrieved via
  // FTS / trigram ILIKE and still scored as 1.0 in ranked.
  const branches = [
    // Empty-query browse (category/brand/gtin filters applied later on product join).
    `
    SELECT p.id AS product_id
    FROM product p
    WHERE $1 = ''`,
    // Full-text search (GIN on search_vector).
    `
    SELECT p.id AS product_id
    FROM product p
    WHERE $1 <> ''
      AND p.search_vector @@ websearch_to_tsquery('simple', $1)`,
    // Prefix via trigram GIN.
    `
    SELECT p.id AS product_id
    FROM product p
    WHERE $1 <> ''
      AND p.name ILIKE $6 || '%' ESCAPE '\\'`,
    // Containment via trigram GIN.
    `
    SELECT p.id AS product_id
    FROM product p
    WHERE $1 <> ''
      AND p.name ILIKE '%' || $6 || '%' ESCAPE '\\'`,
    // GTIN probe (works with empty or non-empty query text).
    `
    SELECT p.id AS product_id
    FROM product p
    WHERE $4::text IS NOT NULL
      AND p.gtin = $4`,
  ];

  if (includeListing) {
    // Listing hits (evidence CTE already filtered with indexed ILIKE).
    branches.push(`
    SELECT lh.product_id
    FROM listing_hit lh`);
  }

  if (includeFuzzy) {
    branches.push(`
    SELECT p.id AS product_id
    FROM product p
    WHERE $1 <> ''
      AND p.name % $1`);
  }

  if (includeAliasHit) {
    branches.push(`
    SELECT ah.product_id
    FROM alias_hit ah`);
  }

  return branches.map((b) => b.trim()).join("\n    UNION\n    ");
}

/** Listing evidence CTE (sim + prefix flags) for scoring joined candidates. */
export function buildListingHitCte(): string {
  return `
    listing_hit AS (
      SELECT l.product_id,
             MAX(similarity(l.name, $1)) AS listing_sim,
             BOOL_OR(l.name ILIKE $6 || '%' ESCAPE '\\') AS listing_prefix,
             BOOL_OR(true) AS listing_contains
      FROM listing l
      WHERE char_length($1) >= 3
        AND l.name ILIKE '%' || $6 || '%' ESCAPE '\\'
      GROUP BY l.product_id
    )`;
}

/** Optional alias evidence CTE for candidates + scoring. */
export function buildAliasHitCte(
  includeFuzzy: boolean,
  trigramThreshold: number,
): string {
  return `
    alias_hit AS (
      SELECT DISTINCT pa.product_id
      FROM product_alias pa
      WHERE pa.product_id IS NOT NULL
        AND $1 <> ''
        AND (
          pa.alias ILIKE '%' || $6 || '%' ESCAPE '\\'
          ${includeFuzzy ? `OR similarity(pa.alias, $1) > ${trigramThreshold}` : ""}
        )
    )`;
}

/**
 * Candidate-first lexical CTE: indexed UNION → join product → score.
 * Default `includeFuzzy=false` omits `p.name % $1` from candidate retrieval.
 * Default `includeListing=true`; set false to skip listing ILIKE scan on first pass.
 */
export function buildLexicalRankedCte(options: LexicalRankedCteOptions = {}): string {
  const includeAliasHit = options.includeAliasHit === true;
  const includeFuzzy = options.includeFuzzy === true;
  const includeListing = options.includeListing !== false;
  const trigramThreshold = options.trigramThreshold ?? 0.4;

  const evidenceCtes: string[] = [];
  if (includeListing) {
    evidenceCtes.push(buildListingHitCte().trim());
  }
  if (includeAliasHit) {
    evidenceCtes.push(buildAliasHitCte(includeFuzzy, trigramThreshold).trim());
  }
  const evidencePrefix =
    evidenceCtes.length > 0 ? `${evidenceCtes.join(",\n    ")},\n    ` : "";

  const aliasScore = includeAliasHit
    ? `CASE WHEN ah.product_id IS NOT NULL THEN 0.7 ELSE 0 END`
    : "0";
  const aliasJoin = includeAliasHit ? "LEFT JOIN alias_hit ah ON ah.product_id = p.id" : "";
  const aliasMatchedVia = includeAliasHit
    ? includeListing
      ? `WHEN ah.product_id IS NOT NULL
                    AND NOT (p.name ILIKE '%' || $6 || '%' ESCAPE '\\')
                    AND lh.product_id IS NULL
                 THEN 'alias'`
      : `WHEN ah.product_id IS NOT NULL
                    AND NOT (p.name ILIKE '%' || $6 || '%' ESCAPE '\\')
                 THEN 'alias'`
    : "";

  const listingScoreArms = includeListing
    ? `CASE
                 WHEN lh.listing_prefix THEN 0.92
                 WHEN lh.listing_contains THEN 0.72
                 ELSE 0
               END,
               -- Never let a chain listing trigram tie/beat an exact product name (1.0).
               LEAST(COALESCE(lh.listing_sim, 0), 0.88)`
    : `0,
               0`;
  const listingJoin = includeListing
    ? "LEFT JOIN listing_hit lh ON lh.product_id = p.id"
    : "";
  const listingMatchedVia = includeListing
    ? `WHEN lh.product_id IS NOT NULL
                    AND COALESCE(lh.listing_sim, 0) >= similarity(p.name, $1)
                    AND NOT (p.name ILIKE '%' || $6 || '%' ESCAPE '\\')
                 THEN 'listing'`
    : "";

  // Score similarity among the bounded candidate set (cheap); fuzzy *retrieval*
  // via `p.name % $1` remains gated by includeFuzzy. Cap below leading whole-word
  // (0.95) so mid-word hosts (חלבה≈חלב, קרחון≈קרח) cannot outrank true staples.
  const nameSimilarityScore = `CASE WHEN $1 = '' THEN 0 ELSE LEAST(similarity(p.name, $1), 0.86) END`;

  return `
    ${evidencePrefix}candidates AS (
      ${buildLexicalCandidateUnionSql(options)}
    ),
    ranked AS (
      SELECT p.id, p.gtin, p.name, p.brand, p.category_l1, p.category_l2,
             p.size_qty, p.size_unit, p.piece_count,
             GREATEST(
               CASE
                 WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 1.0
                 WHEN $1 <> '' AND lower(p.name) = lower($1) THEN 1.0
                 -- Leading whole-word: query is the first token ("חלב תנובה").
                 -- Higher than mid/trailing whole-word so frothers/hosts
                 -- ("מקציף חלב") cannot flood top-K ahead of the commodity.
                 WHEN $1 <> '' AND p.name ILIKE $6 || ' %' ESCAPE '\\' THEN 0.95
                 -- Mid/trailing whole-word token (boundary-aware).
                 WHEN $1 <> '' AND (
                   p.name ILIKE '% ' || $6 ESCAPE '\\'
                   OR p.name ILIKE '% ' || $6 || ' %' ESCAPE '\\'
                 ) THEN 0.88
                 -- Boundary-less substring (קרח→קרחון, חלב→חלבה) stays weaker.
                 WHEN $1 <> '' AND p.name ILIKE '%' || $6 || '%' ESCAPE '\\' THEN 0.78
                 ELSE 0
               END,
               ${nameSimilarityScore},
               ${listingScoreArms},
               ${aliasScore}
             )
             AS score,
             CASE
               WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 'gtin'
               ${aliasMatchedVia}
               ${listingMatchedVia}
               ELSE 'product'
             END AS matched_via
      FROM candidates c
      JOIN product p ON p.id = c.product_id
      ${listingJoin}
      ${aliasJoin}
      WHERE ($2::text IS NULL OR p.category_l1 = $2 OR p.category_l2 = $2)
        AND ($3::text IS NULL OR p.brand ILIKE '%' || $3 || '%' ESCAPE '\\')
        AND ($4::text IS NULL OR p.gtin = $4)
      ORDER BY score DESC, p.name ASC
      LIMIT $7
    )`;
}

export function buildDedupedFromRankedCte(): string {
  return `,
    deduped AS (
      SELECT * FROM ranked
    )`;
}

export function buildSearchResultsSelect(
  localExists: string,
  globalExists: string,
  scoped: boolean,
  stockFilter: string,
  opts?: { orderByStock?: boolean },
): string {
  const orderByStock = opts?.orderByStock !== false;
  const orderBy = orderByStock
    ? `r.score DESC, has_local_price DESC, has_price DESC, r.name ASC`
    : `r.score DESC, r.name ASC`;
  return `
    SELECT r.*,
           ${globalExists} AS has_price,
           ${scoped ? localExists : globalExists} AS has_local_price
    FROM deduped r
    WHERE true ${stockFilter}
    ORDER BY ${orderBy}
    LIMIT $5`;
}
