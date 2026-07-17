import { describe, expect, it } from "vitest";
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "@super-mcp/shared";
import { fuseRankedCandidates } from "../../../src/services/search/rankFusion.js";
import { makeSearchProductHit } from "../../../test/helpers/searchProductHit.js";

describe("fuseRankedCandidates", () => {
  const config = { ...DEFAULT_SEMANTIC_SEARCH_CONFIG, rrfK: 60 };

  it("returns lexical-only candidates with lexical ranks", () => {
    const lexical = [
      makeSearchProductHit({ id: "a", name: "Alpha", score: 0.9 }),
      makeSearchProductHit({ id: "b", name: "Beta", score: 0.8 }),
    ];
    const fused = fuseRankedCandidates(lexical, [], config);
    expect(fused.map((c) => c.id)).toEqual(["a", "b"]);
    expect(fused[0]?.lexicalRank).toBe(1);
    expect(fused[0]?.vectorRank).toBeNull();
    expect(fused[0]?.fusedScore).toBeCloseTo(config.lexicalRrfWeight / (config.rrfK + 1));
  });

  it("returns vector-only candidates with vector ranks", () => {
    const vector = [
      makeSearchProductHit({
        id: "v1",
        name: "Vector One",
        matchedVia: "vector",
        vectorDistance: 0.1,
      }),
    ];
    const fused = fuseRankedCandidates([], vector, config);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.id).toBe("v1");
    expect(fused[0]?.matchedVia).toBe("vector");
    expect(fused[0]?.vectorRank).toBe(1);
    expect(fused[0]?.lexicalRank).toBeNull();
    expect(fused[0]?.vectorDistance).toBe(0.1);
  });

  it("boosts items present in both lists", () => {
    const lexical = [
      makeSearchProductHit({ id: "present-in-both", name: "Both", score: 0.7 }),
      makeSearchProductHit({ id: "lexical-only", name: "Lex", score: 0.95 }),
    ];
    const vector = [
      makeSearchProductHit({
        id: "vector-only",
        name: "Vec",
        matchedVia: "vector",
        vectorDistance: 0.2,
      }),
      makeSearchProductHit({
        id: "present-in-both",
        name: "Both",
        matchedVia: "vector",
        vectorDistance: 0.15,
      }),
    ];
    const fused = fuseRankedCandidates(lexical, vector, config);
    expect(fused[0]?.id).toBe("present-in-both");
    expect(fused.find((x) => x.id === "vector-only")).toBeDefined();
    expect(fused.find((x) => x.id === "lexical-only")).toBeDefined();
    expect(fused[0]?.lexicalRank).toBe(1);
    expect(fused[0]?.vectorRank).toBe(2);
  });

  it("stable-tie-breaks equal fused scores by name", () => {
    // Each list has one rank-1 item → equal RRF; name ASC wins.
    const fused = fuseRankedCandidates(
      [makeSearchProductHit({ id: "z", name: "Zebra", score: 0.9 })],
      [makeSearchProductHit({ id: "a", name: "Aardvark", matchedVia: "vector", score: 0.9 })],
      { ...config, lexicalRrfWeight: 1, vectorRrfWeight: 1 },
    );
    expect(fused.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("preserves lexicalScore and evidence through fusion without overwriting with fusedScore", () => {
    const lexical = [
      makeSearchProductHit({
        id: "exact-prefix",
        name: "Exact Prefix",
        score: 0.016,
        lexicalScore: 0.95,
        evidence: {
          exactName: false,
          exactPhrase: true,
          matchedTokenCount: 0,
          queryTokenCount: 0,
          trigramSimilarity: null,
          aliasMatched: false,
          vectorDistance: null,
          lexicalScore: 0.95,
        },
      }),
    ];
    const vector = [
      makeSearchProductHit({
        id: "exact-prefix",
        name: "Exact Prefix",
        matchedVia: "vector",
        score: 0.012,
        vectorDistance: 0.1,
      }),
    ];
    const fused = fuseRankedCandidates(lexical, vector, config);
    const hit = fused.find((c) => c.id === "exact-prefix");
    expect(hit?.lexicalScore).toBe(0.95);
    expect(hit?.evidence?.lexicalScore).toBe(0.95);
    expect(hit?.evidence?.exactPhrase).toBe(true);
    expect(hit?.score).not.toBe(0.95);
    expect(hit?.score).toBeCloseTo(hit!.fusedScore);
  });

  it("respects configurable RRF weights", () => {
    const lexical = [makeSearchProductHit({ id: "lex", name: "Lex", score: 0.9 })];
    const vector = [
      makeSearchProductHit({ id: "vec", name: "Vec", matchedVia: "vector", score: 0.5 }),
    ];
    const vectorHeavy = fuseRankedCandidates(lexical, vector, {
      ...config,
      lexicalRrfWeight: 0.1,
      vectorRrfWeight: 10,
    });
    expect(vectorHeavy[0]?.id).toBe("vec");

    const lexicalHeavy = fuseRankedCandidates(lexical, vector, {
      ...config,
      lexicalRrfWeight: 10,
      vectorRrfWeight: 0.1,
    });
    expect(lexicalHeavy[0]?.id).toBe("lex");
  });
});
