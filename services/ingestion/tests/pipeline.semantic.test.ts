import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSuccessfulPipelineResult } from "../test/helpers/pipelineResult.js";

const drainSemanticIndex = vi.fn();

vi.mock("@super-mcp/db", () => ({
  getPool: vi.fn(),
  drainSemanticIndex: (...args: unknown[]) => drainSemanticIndex(...args),
}));

describe("drainSemanticAfterIngest", () => {
  beforeEach(() => {
    drainSemanticIndex.mockReset();
    delete process.env.SUPER_MCP_SKIP_SEMANTIC_DRAIN;
    process.env.SUPER_MCP_EMBED_BACKEND = "hasher";
  });

  it("degrades the ingest result when indexing fails items", async () => {
    const { drainSemanticAfterIngest } = await import("../src/pipeline.js");
    drainSemanticIndex.mockResolvedValue({
      model: "x",
      ontologyVersion: "he-retail-v1",
      backend: "hasher",
      queued: 2,
      processed: 1,
      skipped: 0,
      failed: 1,
      remainingDirty: 1,
      durationMs: 5,
    });

    const result = makeSuccessfulPipelineResult();
    await drainSemanticAfterIngest(result);
    expect(result.status).toBe("degraded");
    expect(result.errorSummary).toMatch(/semantic_index/);
  });

  it("degrades when the drain throws", async () => {
    const { drainSemanticAfterIngest } = await import("../src/pipeline.js");
    drainSemanticIndex.mockRejectedValue(new Error("model boom"));

    const result = makeSuccessfulPipelineResult();
    await drainSemanticAfterIngest(result);
    expect(result.status).toBe("degraded");
    expect(result.errorSummary).toMatch(/model boom/);
  });

  it("skips when SUPER_MCP_SKIP_SEMANTIC_DRAIN=1", async () => {
    process.env.SUPER_MCP_SKIP_SEMANTIC_DRAIN = "1";
    const { drainSemanticAfterIngest } = await import("../src/pipeline.js");
    const result = makeSuccessfulPipelineResult();
    await drainSemanticAfterIngest(result);
    expect(drainSemanticIndex).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });
});
