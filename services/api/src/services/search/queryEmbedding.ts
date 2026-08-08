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
 * Force the embedding model into this process at boot.
 *
 * Deliberately bypasses the query cache. `getQueryEmbedding` returns early on a
 * cache hit, and the warmup string is cached after its very first successful run,
 * so warming through it embeds nothing from then on and leaves the model unloaded.
 * The cost then lands on the first shopper to ask something the cache has not seen
 * — measured at ~16s in production, hours after the container started.
 *
 * Resolves once the model can embed; rejects if it cannot, so the caller can log it
 * rather than discover it as a slow request much later.
 */
export async function warmEmbeddingModel(): Promise<void> {
  await embedText(normalizeEmbedInput("warmup"), resolveEmbedModel(), resolveEmbedBackend());
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
