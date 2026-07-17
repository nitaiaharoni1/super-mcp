import {
  embedText,
  getCachedQueryEmbedding,
  putCachedQueryEmbedding,
} from "@super-mcp/db";
import {
  embedInputHash,
  normalizeEmbedInput,
  resolveEmbedBackend,
  resolveEmbedModel,
} from "@super-mcp/shared";

export interface QueryEmbeddingResult {
  vector: number[];
  model: string;
  queryHash: string;
  cacheHit: boolean;
}

export class QueryEmbeddingError extends Error {
  readonly causeError: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "QueryEmbeddingError";
    this.causeError = cause;
  }
}

/**
 * Cache-first query embedding. Normalizes with the same pipeline as product embeds.
 * Throws QueryEmbeddingError on failure so callers can fall back to lexical-only.
 */
export async function getQueryEmbedding(query: string): Promise<QueryEmbeddingResult> {
  const model = resolveEmbedModel();
  const normalizedQuery = normalizeEmbedInput(query);
  const queryHash = embedInputHash(normalizedQuery);

  try {
    const cached = await getCachedQueryEmbedding(queryHash, model);
    if (cached) {
      return { vector: cached, model, queryHash, cacheHit: true };
    }

    const backend = resolveEmbedBackend();
    const vector = await embedText(normalizedQuery, model, backend);
    await putCachedQueryEmbedding({
      queryHash,
      normalizedQuery,
      model,
      vector,
    });
    return { vector, model, queryHash, cacheHit: false };
  } catch (err) {
    if (err instanceof QueryEmbeddingError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new QueryEmbeddingError(`Failed to embed query: ${message}`, err);
  }
}
