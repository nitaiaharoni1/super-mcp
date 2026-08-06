import { describe, expect, it } from "vitest";
import {
  buildDedupedFromRankedCte,
  buildLexicalCandidateUnionSql,
  buildLexicalRankedCte,
  buildSearchResultsSelect,
} from "../../../src/services/search/lexicalSql.js";
import { buildStockFilter } from "../../../src/services/search/sqlUtils.js";

describe("buildLexicalCandidateUnionSql", () => {
  it("builds UNION of indexed candidate branches without fuzzy by default", () => {
    const sql = buildLexicalCandidateUnionSql();
    expect(sql).toMatch(/UNION/i);
    // Avoid lower(name)=lower(q) retrieval — forces seq scan; exact scored in ranked.
    expect(sql).not.toContain("lower(p.name) = lower($1)");
    expect(sql).toContain("p.search_vector @@ websearch_to_tsquery('simple', $1)");
    expect(sql).toContain("p.name ILIKE '%' || $6 || '%' ESCAPE '\\'");
    expect(sql).toContain("FROM listing_hit lh");
    expect(sql).not.toMatch(/p\.name\s*%\s*\$1/);
    expect(sql).not.toMatch(/alias_hit/i);
  });

  it("omits listing branch when includeListing=false", () => {
    const sql = buildLexicalCandidateUnionSql({ includeListing: false });
    expect(sql).not.toContain("FROM listing_hit lh");
    expect(sql).toContain("p.search_vector @@ websearch_to_tsquery('simple', $1)");
  });

  it("adds fuzzy and alias branches when requested", () => {
    const sql = buildLexicalCandidateUnionSql({
      includeAliasHit: true,
      includeFuzzy: true,
      trigramThreshold: 0.4,
    });
    expect(sql).toMatch(/p\.name\s*%\s*\$1/);
    expect(sql).toContain("FROM alias_hit ah");
  });
});

describe("buildLexicalRankedCte", () => {
  it("uses candidates CTE from UNION and does not put OR p.name % $1 in default CTE", () => {
    const cte = buildLexicalRankedCte({ includeAliasHit: true });
    expect(cte).toMatch(/candidates AS/i);
    expect(cte).toMatch(/UNION/i);
    expect(cte).toMatch(/FROM candidates c/i);
    expect(cte).toMatch(/JOIN product p ON p\.id = c\.product_id/i);
    expect(cte).toMatch(/listing_hit AS/i);
    expect(cte).toMatch(/alias_hit AS/i);
    expect(cte).toContain("l.name ILIKE '%' || $6 || '%' ESCAPE '\\'");
    // Default first pass: no trigram % candidate / OR filter.
    expect(cte).not.toMatch(/OR\s+p\.name\s*%\s*\$1/);
    expect(cte).not.toMatch(/p\.name\s*%\s*\$1/);
    // Scoring GREATEST retained (exact name still scored 1.0).
    expect(cte).toMatch(/GREATEST\s*\(/i);
    expect(cte).toContain("WHEN $1 <> '' AND lower(p.name) = lower($1) THEN 1.0");
    // Leading whole-word outranks mid/trailing hosts; trigram capped below it.
    expect(cte).toContain("THEN 0.95");
    expect(cte).toContain("THEN 0.88");
    expect(cte).toContain("LEAST(similarity(p.name, $1), 0.86)");
  });

  it("omits listing_hit CTE and listing score arms when includeListing=false", () => {
    const cte = buildLexicalRankedCte({
      includeAliasHit: true,
      includeListing: false,
    });
    expect(cte).not.toMatch(/listing_hit AS/i);
    expect(cte).not.toContain("FROM listing_hit lh");
    expect(cte).not.toContain("LEFT JOIN listing_hit lh");
    expect(cte).not.toContain("lh.listing_prefix");
    expect(cte).not.toContain("lh.listing_sim");
    expect(cte).not.toContain("THEN 'listing'");
    expect(cte).toMatch(/alias_hit AS/i);
    expect(cte).toMatch(/candidates AS/i);
    expect(cte).toMatch(/GREATEST\s*\(/i);
    // Listing score arms replaced with zeros.
    expect(cte).toMatch(/,\s*0,\s*0,\s*/);
  });

  it("includes fuzzy candidate branch only when includeFuzzy=true", () => {
    const fuzzy = buildLexicalRankedCte({ includeFuzzy: true });
    expect(fuzzy).toMatch(/p\.name\s*%\s*\$1/);
    expect(fuzzy).not.toMatch(/OR\s+p\.name\s*%\s*\$1/);
  });

  it("keeps dedupe + select helpers composable", () => {
    const sql = `
      WITH ${buildLexicalRankedCte()}
      ${buildDedupedFromRankedCte()}
      ${buildSearchResultsSelect("true", "true", false, "")}`;
    expect(sql).toMatch(/deduped AS/i);
    expect(sql).toMatch(/FROM deduped r/i);
    expect(sql).toMatch(/LIMIT \$5/);
  });
});

/**
 * Browsing a catalogue that outlived its prices.
 *
 * Narrowing the ingest to online storefronts left 91,718 products with no price
 * anywhere. Search only ORDERS by store_count, so a better-named unbuyable
 * product still outranks a buyable one: measured against production 2026-08-06,
 * 13 of 80 results across eight staple queries were products no storefront
 * carries, and 7 of 10 for "חלב 3%".
 *
 * The filter belongs on the shared result WHERE, not in the lexical candidate
 * CTE. Lexical is one recall path of several, and filtering only there still
 * returned 4 of 78: every survivor arrived by vector or alias.
 */
describe("pricedOnly", () => {
  it("filters on the shared WHERE, so every recall path is covered", () => {
    const sql = buildSearchResultsSelect("LOCAL", "GLOBAL", false, "AND GLOBAL");
    expect(sql).toContain("WHERE true AND GLOBAL");
  });

  it("is not a candidate-CTE predicate", () => {
    // Narrowing candidates before fusion would change which products compete for
    // slots, which is a ranking change and not the filter that was asked for.
    expect(buildLexicalRankedCte()).not.toContain("AND p.store_count > 0");
    expect(buildLexicalRankedCte({ branchStockedOnly: true })).not.toContain(
      "AND p.store_count > 0",
    );
  });

  it("leaves the physical surface's own filter alone", () => {
    // Two different questions: "can I walk in and buy it" and "will anyone
    // deliver it". branch_store_count is 0 for every product now, so folding
    // them together would return nothing at all.
    expect(buildLexicalRankedCte({ branchStockedOnly: true })).toContain(
      "AND p.branch_store_count > 0",
    );
  });
});

/**
 * The composition itself, because it is what drifted.
 *
 * scoredSearch and exactProductSearch each build this string, and they were
 * byte-identical. Adding pricedOnly to one and not the other left bare-name
 * products coming back unbuyable through the exact path only, which needed a
 * second production measurement to notice.
 */
describe("buildStockFilter", () => {
  const exists = { localExists: "LOCAL", globalExists: "GLOBAL" };

  it("adds nothing when neither narrowing is asked for", () => {
    expect(buildStockFilter({ scoped: true, ...exists })).toBe("");
  });

  it("asks whether anyone in the country prices it, not anyone nearby", () => {
    // pricedOnly is a catalogue question. Scoping it to the requested address
    // would silently make it inStockOnly, which is a different tool parameter.
    expect(buildStockFilter({ pricedOnly: true, scoped: false, ...exists })).toBe("AND GLOBAL");
    expect(buildStockFilter({ pricedOnly: true, scoped: true, ...exists })).toBe("AND GLOBAL");
  });

  it("keeps inStockOnly location-scoped", () => {
    expect(buildStockFilter({ inStockOnly: true, scoped: true, ...exists })).toBe("AND LOCAL");
    // Unscoped there is no location to be in stock at, so it cannot apply.
    expect(buildStockFilter({ inStockOnly: true, scoped: false, ...exists })).toBe("");
  });

  it("composes both rather than letting one win", () => {
    expect(
      buildStockFilter({ inStockOnly: true, pricedOnly: true, scoped: true, ...exists }),
    ).toBe("AND LOCAL AND GLOBAL");
  });
});
