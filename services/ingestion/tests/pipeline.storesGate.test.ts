import type { FeedFile, SourceAdapter } from "@super-mcp/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processFeedFile = vi.fn();

vi.mock("../src/pipeline/persist.js", () => ({
  reapStaleRuns: vi.fn(),
  startRun: vi.fn().mockResolvedValue("run-1"),
  finishRun: vi.fn(),
}));
vi.mock("../src/pipeline/alert.js", () => ({ emitAlert: vi.fn() }));
vi.mock("../src/pipeline/enrich.js", () => ({ drainSemanticAfterIngest: vi.fn() }));
vi.mock("../src/pipeline/processFile.js", () => ({
  processFeedFile: (...args: unknown[]) => processFeedFile(...args),
}));

function file(kind: FeedFile["kind"], chainId: string): FeedFile {
  return {
    sourceId: "test",
    kind,
    chainId,
    remotePath: `/${chainId}/${kind}`,
    fileName: `${chainId}-${kind}`,
  };
}

function adapterWith(files: FeedFile[]): SourceAdapter {
  return {
    sourceId: "test",
    market: "IL",
    discover: async () => files,
    fetch: async () => {
      throw new Error("unused");
    },
    parse: async function* () {},
  } as unknown as SourceAdapter;
}

describe("stores-feed gate (per chain)", () => {
  beforeEach(() => {
    processFeedFile.mockReset();
  });

  it("skips only the failed chain's price files; healthy chains still ingest", async () => {
    processFeedFile.mockImplementation(async (_a: unknown, f: FeedFile) => {
      if (f.kind === "stores" && f.chainId === "A") {
        return { ok: 0, err: 1, processed: false, fatal: "bad stores A" };
      }
      return { ok: 10, err: 0, processed: true };
    });

    const { runPipeline } = await import("../src/pipeline.js");
    const result = await runPipeline(
      adapterWith([file("stores", "A"), file("stores", "B"), file("pricesfull", "A"), file("pricesfull", "B")]),
    );

    // A's price file must never be processed; B's is.
    const processedNames = processFeedFile.mock.calls.map((c) => (c[1] as FeedFile).fileName);
    expect(processedNames).toContain("B-pricesfull");
    expect(processedNames).not.toContain("A-pricesfull");

    expect(result.status).toBe("degraded"); // 2 of 4 files processed
    expect(result.errorSummary).toMatch(/skipped/);
    expect(result.errorSummary).toMatch(/A/);
  });

  it("fails the whole run when every chain's stores feed fails", async () => {
    processFeedFile.mockImplementation(async (_a: unknown, f: FeedFile) => {
      if (f.kind === "stores") return { ok: 0, err: 1, processed: false, fatal: "bad stores" };
      return { ok: 10, err: 0, processed: true };
    });

    const { runPipeline } = await import("../src/pipeline.js");
    const result = await runPipeline(
      adapterWith([file("stores", "A"), file("stores", "B"), file("pricesfull", "A"), file("pricesfull", "B")]),
    );

    const processedNames = processFeedFile.mock.calls.map((c) => (c[1] as FeedFile).fileName);
    expect(processedNames).not.toContain("A-pricesfull");
    expect(processedNames).not.toContain("B-pricesfull");
    expect(result.status).toBe("failed"); // zero files processed
  });
});
