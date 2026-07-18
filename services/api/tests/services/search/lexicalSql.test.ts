import { describe, expect, it } from "vitest";
import {
  buildDedupedFromRankedCte,
  buildLexicalCandidateUnionSql,
  buildLexicalRankedCte,
  buildSearchResultsSelect,
} from "../../../src/services/search/lexicalSql.js";

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
