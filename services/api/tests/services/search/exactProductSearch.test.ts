import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "@super-mcp/shared";
import { makeSearchProductHit } from "../../../test/helpers/searchProductHit.js";

const query = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import {
  buildExactProductRankedCte,
  buildExactProductSearchSql,
  isExactProbeStrong,
  searchExactProducts,
} from "../../../src/services/search/exactProductSearch.js";

describe("exactProductSearch", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("builds product-only SQL without listing CTE or trigram %", () => {
    const cte = buildExactProductRankedCte();
    expect(cte).toContain("candidates AS");
    expect(cte).toMatch(/UNION/i);
    expect(cte).toContain("FROM candidates c");
    expect(cte).toContain("websearch_to_tsquery");
    // Exact scored in ranked; retrieval avoids lower(name)= which seq-scans.
    expect(cte).toContain("WHEN $1 <> '' AND lower(p.name) = lower($1) THEN 1.0");
    expect(cte).not.toContain("listing_hit");
    expect(cte).not.toContain("p.name % $1");
    expect(cte).not.toContain("FROM listing");

    const sql = buildExactProductSearchSql("EXISTS(1)", "EXISTS(1)", false, "");
    expect(sql).toContain("WITH");
    expect(sql).toContain("deduped");
    expect(sql).not.toContain("p.name % $1");
  });

  it("searchExactProducts passes candidate limit as overFetch ($7)", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "p1",
          gtin: null,
          name: "Cola",
          brand: null,
          category_l1: null,
          category_l2: null,
          size_qty: null,
          size_unit: null,
          score: 1,
          matched_via: "product",
          has_price: true,
          has_local_price: true,
        },
      ],
    });

    const rows = await searchExactProducts({ q: "Cola", limit: 60 }, 10);

    expect(rows).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    // $1=q, $5=outer limit (set to overFetch), $6=qLike, $7=overFetch
    expect(params[0]).toBe("Cola");
    expect(params[4]).toBe(10);
    expect(params[6]).toBe(10);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toContain("p.name % $1");
    expect(sql).not.toContain("listing_hit");
  });

  it("isExactProbeStrong accepts exact name regardless of siblings", () => {
    const hits = [
      makeSearchProductHit({
        id: "a",
        name: "Onion",
        score: 1,
        lexicalScore: 1,
        evidence: {
          exactName: true,
          exactPhrase: true,
          matchedTokenCount: 1,
          queryTokenCount: 1,
          trigramSimilarity: null,
          aliasMatched: false,
          vectorDistance: null,
          lexicalScore: 1,
        },
      }),
      makeSearchProductHit({
        id: "b",
        name: "Onion",
        score: 1,
        lexicalScore: 1,
        evidence: {
          exactName: true,
          exactPhrase: true,
          matchedTokenCount: 1,
          queryTokenCount: 1,
          trigramSimilarity: null,
          aliasMatched: false,
          vectorDistance: null,
          lexicalScore: 1,
        },
      }),
    ];
    expect(isExactProbeStrong(hits, DEFAULT_SEMANTIC_SEARCH_CONFIG)).toBe(true);
  });

  it("isExactProbeStrong rejects weak containment without exact/prefix dominance", () => {
    const hits = [
      makeSearchProductHit({
        id: "weak",
        name: "Something with cola syrup",
        score: 0.78,
        lexicalScore: 0.78,
        evidence: {
          exactName: false,
          exactPhrase: false,
          matchedTokenCount: 1,
          queryTokenCount: 1,
          trigramSimilarity: null,
          aliasMatched: false,
          vectorDistance: null,
          lexicalScore: 0.78,
        },
      }),
    ];
    expect(isExactProbeStrong(hits, DEFAULT_SEMANTIC_SEARCH_CONFIG)).toBe(false);
  });
});
