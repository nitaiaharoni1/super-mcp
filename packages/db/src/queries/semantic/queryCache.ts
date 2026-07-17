import { DEFAULT_EMBED_DIMS, formatVectorLiteral } from "@super-mcp/shared";
import { query } from "../query.js";

function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const nums = value.map(Number);
    if (nums.length !== DEFAULT_EMBED_DIMS || !nums.every(Number.isFinite)) return null;
    return nums;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) return null;
  const nums = trimmed.split(",").map((s) => Number(s.trim()));
  if (nums.length !== DEFAULT_EMBED_DIMS || !nums.every(Number.isFinite)) return null;
  return nums;
}

/** Read cached query embedding and increment hit counter. */
export async function getCachedQueryEmbedding(
  queryHash: string,
  model: string,
): Promise<number[] | null> {
  const res = await query<{ embedding: unknown }>(
    `SELECT embedding::text AS embedding
     FROM semantic_query_embedding
     WHERE query_hash = $1 AND model = $2`,
    [queryHash, model],
  );
  const row = res.rows[0];
  if (!row) return null;
  const vec = parseVector(row.embedding);
  if (!vec) {
    // Corrupt / wrong-dim cache entry — drop so the next embed can repopulate.
    await query(
      `DELETE FROM semantic_query_embedding WHERE query_hash = $1 AND model = $2`,
      [queryHash, model],
    );
    return null;
  }
  await query(
    `UPDATE semantic_query_embedding
     SET hits = hits + 1
     WHERE query_hash = $1 AND model = $2`,
    [queryHash, model],
  );
  return vec;
}

/** Upsert a query embedding into the cache. Rejects wrong-dim / non-finite vectors. */
export async function putCachedQueryEmbedding(input: {
  queryHash: string;
  normalizedQuery: string;
  model: string;
  vector: number[];
}): Promise<void> {
  if (
    input.vector.length !== DEFAULT_EMBED_DIMS ||
    !input.vector.every(Number.isFinite)
  ) {
    throw new Error(
      `refusing to cache query embedding: expected ${DEFAULT_EMBED_DIMS} finite dims, got ${input.vector.length}`,
    );
  }
  const literal = formatVectorLiteral(input.vector);
  await query(
    `INSERT INTO semantic_query_embedding
       (query_hash, normalized_query, model, embedding, hits)
     VALUES ($1, $2, $3, $4::vector, 0)
     ON CONFLICT (query_hash, model) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       normalized_query = EXCLUDED.normalized_query,
       embedded_at = now()`,
    [input.queryHash, input.normalizedQuery, input.model, literal],
  );
}
