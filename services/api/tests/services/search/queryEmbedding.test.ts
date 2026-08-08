import { beforeEach, describe, expect, it, vi } from "vitest";

const getCachedQueryEmbedding = vi.fn();
const putCachedQueryEmbedding = vi.fn();
const embedText = vi.fn();

vi.mock("@super-mcp/db", () => ({
  getCachedQueryEmbedding: (...args: unknown[]) => getCachedQueryEmbedding(...args),
  putCachedQueryEmbedding: (...args: unknown[]) => putCachedQueryEmbedding(...args),
  embedText: (...args: unknown[]) => embedText(...args),
}));

vi.mock("@super-mcp/shared", async () => {
  const actual = await vi.importActual<typeof import("@super-mcp/shared")>("@super-mcp/shared");
  return {
    ...actual,
    resolveEmbedModel: () => "test-model",
    resolveEmbedBackend: () => "hasher" as const,
  };
});

import { embedInputHash, normalizeEmbedInput } from "@super-mcp/shared";
import {
  getQueryEmbedding,
  QueryEmbeddingError,
  warmEmbeddingModel,
} from "../../../src/services/search/queryEmbedding.js";

describe("getQueryEmbedding", () => {
  beforeEach(() => {
    getCachedQueryEmbedding.mockReset();
    putCachedQueryEmbedding.mockReset();
    embedText.mockReset();
  });

  it("embeds once for the same normalized query (cache hit on second call)", async () => {
    const vector = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
    getCachedQueryEmbedding.mockResolvedValueOnce(null).mockResolvedValueOnce(vector);
    embedText.mockResolvedValue(vector);
    putCachedQueryEmbedding.mockResolvedValue(undefined);

    const first = await getQueryEmbedding("  Fresh Chicken  ");
    const second = await getQueryEmbedding("fresh chicken");

    expect(embedText).toHaveBeenCalledTimes(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(first.queryHash).toBe(second.queryHash);
    expect(first.queryHash).toBe(embedInputHash(normalizeEmbedInput("Fresh Chicken")));
    expect(putCachedQueryEmbedding).toHaveBeenCalledTimes(1);
  });

  it("throws QueryEmbeddingError when embedder fails", async () => {
    getCachedQueryEmbedding.mockResolvedValue(null);
    embedText.mockRejectedValue(new Error("boom"));
    await expect(getQueryEmbedding("חלב")).rejects.toBeInstanceOf(QueryEmbeddingError);
  });
});

describe("warmEmbeddingModel", () => {
  beforeEach(() => {
    getCachedQueryEmbedding.mockReset();
    putCachedQueryEmbedding.mockReset();
    embedText.mockReset();
  });

  // A populated cache is the steady state in production: the warmup vector was
  // stored the first time this ever ran. Warming through getQueryEmbedding would
  // hit that entry, return early, and leave the model unloaded — handing the full
  // model-load cost to the first user who asks something the cache has not seen.
  it("loads the model even when the query cache would hit", async () => {
    const vector = Array.from({ length: 384 }, () => 0);
    getCachedQueryEmbedding.mockResolvedValue(vector);
    embedText.mockResolvedValue(vector);

    await warmEmbeddingModel();

    expect(embedText).toHaveBeenCalledTimes(1);
    expect(getCachedQueryEmbedding).not.toHaveBeenCalled();
  });

  it("does not write the warmup vector back to the shared query cache", async () => {
    embedText.mockResolvedValue(Array.from({ length: 384 }, () => 0));
    await warmEmbeddingModel();
    expect(putCachedQueryEmbedding).not.toHaveBeenCalled();
  });
});
