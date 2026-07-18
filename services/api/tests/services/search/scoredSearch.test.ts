import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "@super-mcp/shared";
import { heRetailOntologyFixture } from "@super-mcp/shared/test-utils";
import { makeSearchProductHit } from "../../../test/helpers/searchProductHit.js";

const getActiveOntology = vi.fn();
const getQueryEmbedding = vi.fn();
const searchByQueryVector = vi.fn();
const query = vi.fn();
const semanticBasketEnabled = vi.fn(() => true);
const semanticV2RecallEnabled = vi.fn(() => true);
const semanticV2Shadow = vi.fn(() => false);

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

vi.mock("../../../src/services/search/ontology.js", () => ({
  getActiveOntology: (...args: unknown[]) => getActiveOntology(...args),
}));

vi.mock("../../../src/services/search/queryEmbedding.js", () => ({
  getQueryEmbedding: (...args: unknown[]) => getQueryEmbedding(...args),
  QueryEmbeddingError: class QueryEmbeddingError extends Error {},
}));

vi.mock("../../../src/services/search/vectorSearch.js", () => ({
  searchByQueryVector: (...args: unknown[]) => searchByQueryVector(...args),
}));

vi.mock("../../../src/lib/features.js", () => ({
  semanticBasketEnabled: () => semanticBasketEnabled(),
  semanticV2RecallEnabled: () => semanticV2RecallEnabled(),
  semanticV2Shadow: () => semanticV2Shadow(),
}));

import {
  orderByLocationStock,
  searchProductsScored,
} from "../../../src/services/search/scoredSearch.js";

function weakLexicalRow() {
  return {
    id: "lex",
    gtin: "1",
    name: "lexical match",
    brand: null,
    category_l1: null,
    category_l2: null,
    size_qty: null,
    size_unit: null,
    score: 0.78,
    matched_via: "product" as const,
    has_price: true,
    has_local_price: true,
  };
}

describe("searchProductsScored hybrid path", () => {
  const lexicalHit = makeSearchProductHit({
    id: "lex",
    name: "lexical match",
    score: 0.78,
    hasLocalPrice: true,
  });
  const vectorHit = makeSearchProductHit({
    id: "vec",
    name: "vector match",
    score: 0,
    matchedVia: "vector",
    vectorDistance: 0.2,
    hasLocalPrice: true,
  });

  beforeEach(() => {
    getActiveOntology.mockReset();
    getQueryEmbedding.mockReset();
    searchByQueryVector.mockReset();
    query.mockReset();
    semanticBasketEnabled.mockReturnValue(true);
    semanticV2RecallEnabled.mockReturnValue(true);
    semanticV2Shadow.mockReturnValue(false);

    getActiveOntology.mockResolvedValue({
      ...heRetailOntologyFixture(),
      searchConfig: { ...DEFAULT_SEMANTIC_SEARCH_CONFIG, vectorLimit: 20 },
    });
    getQueryEmbedding.mockResolvedValue({
      vector: Array.from({ length: 384 }, (_, i) => i * 0.001),
      model: "test-model",
      cacheHit: false,
    });
    searchByQueryVector.mockResolvedValue([vectorHit]);
    // Exact probe + lexical passes share this mock; weak name keeps probe from short-circuiting.
    query.mockResolvedValue({ rows: [weakLexicalRow()] });
  });

  it("falls back to lexical when ontology is unavailable", async () => {
    getActiveOntology.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const hits = await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(getQueryEmbedding).not.toHaveBeenCalled();
    expect(searchByQueryVector).not.toHaveBeenCalled();
    expect(hits.map((h) => h.id)).toEqual(["lex"]);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("ontology_unavailable")),
    ).toBe(true);
    warn.mockRestore();
  });

  it("returns early via exact_probe for exact product name", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "exact-1",
          gtin: "1",
          name: "פרגיות",
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
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const hits = await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(hits.map((hit) => hit.id)).toEqual(["exact-1"]);
    expect(getQueryEmbedding).not.toHaveBeenCalled();
    expect(searchByQueryVector).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('"path":"exact_probe"');
    log.mockRestore();
  });

  it("uses firstPassLexicalLimit (20) for non-fuzzy product-only SQL overFetch when limit is 60", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // Weak exact probe → continue to first-pass lexical.
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({
      rows: [
        {
          id: lexicalHit.id,
          gtin: "1",
          name: "פרגיות עוף טרי",
          brand: null,
          category_l1: null,
          category_l2: null,
          size_qty: null,
          size_unit: null,
          score: 0.78,
          matched_via: "product",
          has_price: true,
          has_local_price: true,
        },
      ],
    });

    await searchProductsScored({ q: "פרגיות", limit: 60 });

    // First-pass lexical: GREATEST scoring CTE without listing_hit (not exact probe).
    const lexicalCall = query.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        String(c[0]).includes("GREATEST") &&
        String(c[0]).includes("candidates AS") &&
        !String(c[0]).includes("listing_hit AS"),
    );
    expect(lexicalCall).toBeTruthy();
    const params = lexicalCall![1] as unknown[];
    // $7 = overFetch must be firstPassLexicalLimit (20), not max(20, 60)=60
    expect(params[6]).toBe(20);
    const sql = String(lexicalCall![0]);
    // First pass is non-fuzzy and product+alias only (no listing ILIKE).
    expect(sql).not.toMatch(/p\.name % \$1/);
    expect(sql).not.toContain("l.name ILIKE '%' || $6 || '%' ESCAPE '\\'");
    log.mockRestore();
  });

  it("retries weak first-pass with listing + fuzzy before vector", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    query.mockResolvedValueOnce({ rows: [] }); // exact probe
    query.mockResolvedValueOnce({ rows: [weakLexicalRow()] }); // first-pass no listing
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "listed",
          gtin: "2",
          name: "chain listing hit",
          brand: null,
          category_l1: null,
          category_l2: null,
          size_qty: null,
          size_unit: null,
          score: 0.92,
          matched_via: "listing",
          has_price: true,
          has_local_price: true,
        },
      ],
    }); // fuzzy + listing

    await searchProductsScored({ q: "פרגיות", limit: 10 });

    const lexicalCalls = query.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        String(c[0]).includes("GREATEST") &&
        String(c[0]).includes("candidates AS"),
    );
    expect(lexicalCalls.length).toBeGreaterThanOrEqual(2);
    const firstPassSql = String(lexicalCalls[0]![0]);
    const listingPassSql = String(
      lexicalCalls.find((c) => String(c[0]).includes("listing_hit AS"))?.[0] ?? "",
    );
    expect(firstPassSql).not.toMatch(/listing_hit AS/i);
    expect(firstPassSql).not.toMatch(/p\.name % \$1/);
    expect(listingPassSql).toMatch(/listing_hit AS/i);
    expect(listingPassSql).toMatch(/p\.name % \$1/);
    expect(getQueryEmbedding).toHaveBeenCalled();
    log.mockRestore();
  });

  it("skips embedding and ANN for strong lexical evidence after weak exact probe", async () => {
    // Exact probe: empty → continue to lexical.
    query.mockResolvedValueOnce({ rows: [] });
    // Non-fuzzy lexical: dominant prefix hit.
    query.mockResolvedValueOnce({
      rows: [
        {
          id: lexicalHit.id,
          gtin: "1",
          name: "פרגיות עוף",
          brand: null,
          category_l1: null,
          category_l2: null,
          size_qty: null,
          size_unit: null,
          score: 0.95,
          matched_via: "product",
          has_price: true,
          has_local_price: true,
        },
      ],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const hits = await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(hits.map((hit) => hit.id)).toEqual(["lex"]);
    expect(getQueryEmbedding).not.toHaveBeenCalled();
    expect(searchByQueryVector).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain('"path":"deterministic_only"');
    log.mockRestore();
  });

  it("falls back to lexical when query embedding fails", async () => {
    const { QueryEmbeddingError } = await import(
      "../../../src/services/search/queryEmbedding.js"
    );
    getQueryEmbedding.mockRejectedValue(new QueryEmbeddingError("embed down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const hits = await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(searchByQueryVector).not.toHaveBeenCalled();
    expect(hits.map((h) => h.id)).toEqual(["lex"]);
    expect(String(warn.mock.calls[0]?.[0])).toContain("query_embed_failed");
    warn.mockRestore();
  });

  it("fuses lexical + vector when recall is on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const hits = await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(getQueryEmbedding).toHaveBeenCalled();
    expect(searchByQueryVector).toHaveBeenCalled();
    expect(hits.map((h) => h.id).sort()).toEqual(["lex", "vec"].sort());
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('"event":"semantic_search"');
    log.mockRestore();
  });

  it("returns lexical ordering under V2 shadow after computing fusion", async () => {
    semanticV2Shadow.mockReturnValue(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const hits = await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(searchByQueryVector).toHaveBeenCalled();
    expect(hits[0]?.id).toBe("lex");
    expect(String(log.mock.calls.at(-1)?.[0])).toContain("v2_shadow_return_lexical");
    log.mockRestore();
  });

  it("skips hybrid when V2 recall is disabled", async () => {
    semanticV2RecallEnabled.mockReturnValue(false);

    await searchProductsScored({ q: "פרגיות", limit: 10 });

    expect(getQueryEmbedding).not.toHaveBeenCalled();
    expect(searchByQueryVector).not.toHaveBeenCalled();
  });

  it("keeps a stronger non-local match ahead of local stock", () => {
    const ranked = orderByLocationStock(
      [
        makeSearchProductHit({
          id: "local-weaker",
          name: "local weaker",
          score: 0.78,
          hasLocalPrice: true,
        }),
        makeSearchProductHit({
          id: "global-stronger",
          name: "global stronger",
          score: 0.95,
          hasLocalPrice: false,
        }),
      ],
      10,
    );

    expect(ranked.map((hit) => hit.id)).toEqual(["global-stronger", "local-weaker"]);
  });
});
