import { scrubNullChars } from "@super-mcp/shared";
import { drainSemanticIndex } from "@super-mcp/db";
import type { PipelineResult } from "./types.js";

/**
 * Drain semantic_index_dirty after successful feed writes.
 * Never rolls back ingest data; failures mark the run degraded and leave the queue.
 */
export async function drainSemanticAfterIngest(result: PipelineResult): Promise<void> {
  if (process.env.SUPER_MCP_SKIP_SEMANTIC_DRAIN === "1") return;
  try {
    const drain = await drainSemanticIndex({
      dirtyOnly: true,
      limit: Math.max(1, Number(process.env.SUPER_MCP_SEMANTIC_DRAIN_LIMIT ?? "50000") || 50_000),
      backend:
        process.env.SUPER_MCP_EMBED_BACKEND?.trim().toLowerCase() === "hasher"
          ? "hasher"
          : "transformers",
    });
    console.log(
      JSON.stringify({
        event: "ingestion_semantic_drain",
        sourceId: result.sourceId,
        ...drain,
      }),
    );
    if (drain.failed > 0) {
      result.status = "degraded";
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") +
        `semantic_index: failed=${drain.failed} remaining=${drain.remainingDirty}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = "degraded";
    result.errorSummary =
      (result.errorSummary ? result.errorSummary + "; " : "") + `semantic_index: ${msg}`;
    console.error(
      scrubNullChars(
        JSON.stringify({
          severity: "ERROR",
          event: "ingestion_semantic_drain_failed",
          sourceId: result.sourceId,
          error: msg,
        }),
      ),
    );
  }
}
