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
    // Lexical SQL path — return one row shaped like SearchHitRow via query mock.
    query.mockResolvedValue({
      rows: [
        {
          id: lexicalHit.id,
          gtin: "1",
          name: lexicalHit.name,
          brand: null,
          category_l1: null,
          category_l2: null,
          size_qty: null,
          size_unit: null,
          score: 0.78,
          matched_via: "name",
          has_price: true,
          has_local_price: true,
        },
      ],
    });
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

  it("skips embedding and ANN for strong lexical evidence", async () => {
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
          matched_via: "name",
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
    // Put vector-only hit first in fused ranking by giving it sole presence + high weight path:
    // keep both; shadow must still return lexical order (lex first from SQL).
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
