/** Shared lexical ranking CTE used by hybrid and fallback search. */
export function buildLexicalRankedCte(
  includeAliasHit: boolean,
  trigramThreshold = 0.4,
): string {
  const aliasHitCte = includeAliasHit
    ? `
    alias_hit AS (
      SELECT DISTINCT pa.product_id
      FROM product_alias pa
      WHERE pa.product_id IS NOT NULL
        AND $1 <> ''
        AND (
          pa.alias ILIKE '%' || $6 || '%' ESCAPE '\\'
          OR similarity(pa.alias, $1) > ${trigramThreshold}
        )
    ),`
    : "";

  const aliasScore = includeAliasHit ? `CASE WHEN ah.product_id IS NOT NULL THEN 0.7 ELSE 0 END` : "0";
  const aliasJoin = includeAliasHit ? "LEFT JOIN alias_hit ah ON ah.product_id = p.id" : "";
  const aliasWhere = includeAliasHit ? "OR ah.product_id IS NOT NULL" : "";
  const aliasMatchedVia = includeAliasHit
    ? `WHEN ah.product_id IS NOT NULL
                    AND NOT (p.name ILIKE '%' || $6 || '%' ESCAPE '\\')
                    AND lh.product_id IS NULL
                 THEN 'alias'`
    : "";

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
    ),${aliasHitCte}
    ranked AS (
      SELECT p.id, p.gtin, p.name, p.brand, p.category_l1, p.category_l2, p.size_qty, p.size_unit,
             GREATEST(
               CASE
                 WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 1.0
                 WHEN $1 <> '' AND lower(p.name) = lower($1) THEN 1.0
                 WHEN $1 <> '' AND p.name ILIKE $6 || '%' ESCAPE '\\' THEN 0.95
                 WHEN $1 <> '' AND (
                   p.name ILIKE $6 || ' %' ESCAPE '\\'
                   OR p.name ILIKE '% ' || $6 ESCAPE '\\'
                   OR p.name ILIKE '% ' || $6 || ' %' ESCAPE '\\'
                 ) THEN 0.9
                 WHEN $1 <> '' AND p.name ILIKE '%' || $6 || '%' ESCAPE '\\' THEN 0.78
                 ELSE 0
               END,
               CASE WHEN $1 = '' THEN 0 ELSE similarity(p.name, $1) END,
               CASE
                 WHEN lh.listing_prefix THEN 0.92
                 WHEN lh.listing_contains THEN 0.72
                 ELSE 0
               END,
               -- Never let a chain listing trigram tie/beat an exact product name (1.0).
               LEAST(COALESCE(lh.listing_sim, 0), 0.88),
               ${aliasScore}
             )
             AS score,
             CASE
               WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 'gtin'
               ${aliasMatchedVia}
               WHEN lh.product_id IS NOT NULL
                    AND COALESCE(lh.listing_sim, 0) >= similarity(p.name, $1)
                    AND NOT (p.name ILIKE '%' || $6 || '%' ESCAPE '\\')
                 THEN 'listing'
               ELSE 'product'
             END AS matched_via
      FROM product p
      LEFT JOIN listing_hit lh ON lh.product_id = p.id
      ${aliasJoin}
      WHERE (
              $1 = ''
              OR p.search_vector @@ websearch_to_tsquery('simple', $1)
              OR p.name % $1
              OR p.name ILIKE '%' || $6 || '%' ESCAPE '\\'
              OR lh.product_id IS NOT NULL
              ${aliasWhere}
            )
        AND ($2::text IS NULL OR p.category_l1 = $2 OR p.category_l2 = $2)
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
