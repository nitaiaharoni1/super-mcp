/**
 * The capped-run signal.
 *
 * A capped run is a legitimate local smoke test and a serious production incident,
 * and until now the two were indistinguishable in the output. The Cloud Run job set
 * neither SUPER_MCP_NO_CAP nor SUPER_MCP_FULL, so it refreshed 8 of 898 stores every
 * night for a week while reporting status "success" with rowsError 0. The
 * chain-coverage gate could not catch it because expectedChainIdsForSource mirrors
 * what the adapter ATTEMPTS, so the expectation shrank to match the degraded mode.
 *
 * These tests pin the signal that makes the difference visible.
 */
import type { FeedFile, SourceAdapter } from "@super-mcp/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processFeedFile = vi.fn();
const poolQuery = vi.fn();

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
// Mocked so the store count is deterministic rather than whatever the dev DB holds.
vi.mock("@super-mcp/db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => poolQuery(...args) }),
}));

const RAMI_LEVY = "7290058140886";
const YOHANANOF = "7290803800003";

function file(kind: FeedFile["kind"], chainId: string): FeedFile {
  return {
    sourceId: "il-cerberus",
    kind,
    chainId,
    storeId: "001",
    remotePath: `/${chainId}/${kind}`,
    fileName: `${chainId}-${kind}`,
  };
}

function cerberusAdapter(): SourceAdapter {
  return {
    sourceId: "il-cerberus",
    market: "IL",
    discover: async () => [
      file("stores", RAMI_LEVY),
      file("pricesfull", RAMI_LEVY),
      file("stores", YOHANANOF),
      file("pricesfull", YOHANANOF),
    ],
    fetch: async () => {
      throw new Error("unused");
    },
    parse: async function* () {},
  } as unknown as SourceAdapter;
}

const previousNoCap = process.env.SUPER_MCP_NO_CAP;
const previousFull = process.env.SUPER_MCP_FULL;

beforeEach(() => {
  vi.resetModules();
  processFeedFile.mockReset().mockResolvedValue({ ok: 100, err: 0, processed: true });
  poolQuery.mockReset().mockResolvedValue({ rows: [{ n: "898" }] });
});

afterEach(() => {
  if (previousNoCap === undefined) delete process.env.SUPER_MCP_NO_CAP;
  else process.env.SUPER_MCP_NO_CAP = previousNoCap;
  if (previousFull === undefined) delete process.env.SUPER_MCP_FULL;
  else process.env.SUPER_MCP_FULL = previousFull;
});

describe("capped vs full coverage is reported", () => {
  it("labels a default run as capped_smoke and names the store cap", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    delete process.env.SUPER_MCP_FULL;
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(cerberusAdapter());

    // status stays "success" on purpose: every chain it ATTEMPTED delivered. The
    // coverage fields are what reveal that it attempted almost nothing.
    expect(result.status).toBe("success");
    expect(result.coverageMode).toBe("capped_smoke");
    expect(result.storeCap).toBe(2);
  });

  it("labels a SUPER_MCP_NO_CAP run as full with no store cap", async () => {
    process.env.SUPER_MCP_NO_CAP = "1";
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(cerberusAdapter());

    expect(result.coverageMode).toBe("full");
    expect(result.storeCap).toBeNull();
  });

  it("labels a SUPER_MCP_FULL run as full too", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    process.env.SUPER_MCP_FULL = "1";
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(cerberusAdapter());

    expect(result.coverageMode).toBe("full");
    expect(result.storeCap).toBeNull();
  });

  it("WARNs when a capped run hits a populated database", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    delete process.env.SUPER_MCP_FULL;
    poolQuery.mockResolvedValue({ rows: [{ n: "898" }] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runPipeline } = await import("../src/pipeline.js");

    await runPipeline(cerberusAdapter());

    const warning = spy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes("ingestion_capped_run"));
    expect(warning, "no ingestion_capped_run line was logged").toBeDefined();
    const parsed = JSON.parse(warning!) as Record<string, unknown>;
    expect(parsed.severity).toBe("WARNING");
    expect(parsed.storesInDatabase).toBe(898);
    expect(parsed.storeCap).toBe(2);
    // The message must name the flag, or the reader still does not know the fix.
    expect(String(parsed.hint)).toContain("SUPER_MCP_NO_CAP");
    spy.mockRestore();
  });

  it("stays INFO for a capped run against a small fixture database", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    delete process.env.SUPER_MCP_FULL;
    poolQuery.mockResolvedValue({ rows: [{ n: "3" }] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runPipeline } = await import("../src/pipeline.js");

    await runPipeline(cerberusAdapter());

    const line = spy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("ingestion_capped_run"));
    expect(line).toBeDefined();
    // Local smoke work must not be trained to ignore a WARNING it sees constantly.
    expect((JSON.parse(line!) as { severity: string }).severity).toBe("INFO");
    spy.mockRestore();
  });

  it("emits no capped warning at all when the run is full", async () => {
    process.env.SUPER_MCP_NO_CAP = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runPipeline } = await import("../src/pipeline.js");

    await runPipeline(cerberusAdapter());

    expect(
      spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes("ingestion_capped_run")),
    ).toBeUndefined();
    spy.mockRestore();
  });
});
