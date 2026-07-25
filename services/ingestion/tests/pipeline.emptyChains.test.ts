import type { FeedFile, SourceAdapter } from "@super-mcp/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processFeedFile = vi.fn();
const finishRun = vi.fn();

vi.mock("../src/pipeline/persist.js", () => ({
  reapStaleRuns: vi.fn(),
  startRun: vi.fn().mockResolvedValue("run-1"),
  finishRun: (...args: unknown[]) => finishRun(...args),
}));
vi.mock("../src/pipeline/alert.js", () => ({ emitAlert: vi.fn() }));
vi.mock("../src/pipeline/enrich.js", () => ({ drainSemanticAfterIngest: vi.fn() }));
vi.mock("../src/pipeline/processFile.js", () => ({
  processFeedFile: (...args: unknown[]) => processFeedFile(...args),
}));

/** The first two Cerberus chains — the ones a default (capped) run attempts. */
const RAMI_LEVY = "7290058140886";
const YOHANANOF = "7290803800003";
/** Configured but publishes nothing: FTP authenticates, directory is empty.
 *  Marked knownInactive, so it is attempted but never expected to deliver. */
const HAZI_HINAM = "7290700100008";
/** A live chain: verified publishing 67 PriceFull files on 2026-07-25. */
const OSHER_AD = "7290103152017";

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

function cerberusAdapter(files: FeedFile[]): SourceAdapter {
  return {
    sourceId: "il-cerberus",
    market: "IL",
    discover: async () => files,
    fetch: async () => {
      throw new Error("unused");
    },
    parse: async function* () {},
  } as unknown as SourceAdapter;
}

const previousNoCap = process.env.SUPER_MCP_NO_CAP;

beforeEach(() => {
  processFeedFile.mockReset().mockImplementation(async () => ({
    ok: 100,
    err: 0,
    processed: true,
  }));
  finishRun.mockReset();
});

afterEach(() => {
  if (previousNoCap === undefined) delete process.env.SUPER_MCP_NO_CAP;
  else process.env.SUPER_MCP_NO_CAP = previousNoCap;
});

describe("configured chain that yields nothing", () => {
  it("degrades the run when a live chain produced no files", async () => {
    // All nine Cerberus chains are attempted, but only two publish anything.
    process.env.SUPER_MCP_NO_CAP = "1";
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(
      cerberusAdapter([
        file("stores", RAMI_LEVY),
        file("pricesfull", RAMI_LEVY),
        file("stores", YOHANANOF),
        file("pricesfull", YOHANANOF),
      ]),
    );

    expect(result.status).toBe("degraded");
    // Osher Ad is a live chain: verified 2026-07-25 as publishing 67 PriceFull
    // files that day. Silence from it is real lost coverage.
    expect(result.chainsWithNoFiles).toContain(OSHER_AD);
    expect(result.errorSummary).toContain(OSHER_AD);
  });

  it("does not degrade on a chain marked knownInactive", async () => {
    // HaziHinam authenticates and publishes nothing, permanently. Expecting data
    // from it would make every full run degraded and fire a nightly ERROR alert,
    // and an alert that always fires is one nobody reads. It stays configured, so
    // it is still attempted and would be picked up if it ever starts publishing.
    process.env.SUPER_MCP_NO_CAP = "1";
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(
      cerberusAdapter([
        file("stores", RAMI_LEVY),
        file("pricesfull", RAMI_LEVY),
        file("stores", YOHANANOF),
        file("pricesfull", YOHANANOF),
      ]),
    );

    expect(result.chainsWithNoFiles).not.toContain(HAZI_HINAM);
    expect(result.errorSummary ?? "").not.toContain(HAZI_HINAM);
  });

  it("stays successful when every attempted chain delivered (default 2-chain cap)", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(
      cerberusAdapter([
        file("stores", RAMI_LEVY),
        file("pricesfull", RAMI_LEVY),
        file("stores", YOHANANOF),
        file("pricesfull", YOHANANOF),
      ]),
    );

    // The capped local run must not be permanently degraded by the 7 chains it
    // never attempts.
    expect(result.chainsWithNoFiles).toEqual([]);
    expect(result.chainsWithNoRows).toEqual([]);
    expect(result.status).toBe("success");
  });

  it("degrades when a chain discovered files but produced zero rows", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    processFeedFile.mockImplementation(async (_a: unknown, f: FeedFile) =>
      f.chainId === YOHANANOF
        ? { ok: 0, err: 0, processed: true }
        : { ok: 100, err: 0, processed: true },
    );
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(
      cerberusAdapter([
        file("stores", RAMI_LEVY),
        file("pricesfull", RAMI_LEVY),
        file("stores", YOHANANOF),
        file("pricesfull", YOHANANOF),
      ]),
    );

    expect(result.status).toBe("degraded");
    expect(result.chainsWithNoRows).toContain(YOHANANOF);
  });

  it("applies no chain expectation to single-chain sources", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const shufersal = {
      sourceId: "il-shufersal",
      market: "IL",
      discover: async () => [file("stores", "7290027600007"), file("pricesfull", "7290027600007")],
      fetch: async () => {
        throw new Error("unused");
      },
      parse: async function* () {},
    } as unknown as SourceAdapter;

    const result = await runPipeline(shufersal);
    expect(result.chainsWithNoFiles).toEqual([]);
    expect(result.status).toBe("success");
  });

  it("reports reconciled price counts on the run", async () => {
    delete process.env.SUPER_MCP_NO_CAP;
    processFeedFile.mockImplementation(async () => ({
      ok: 100,
      err: 0,
      processed: true,
      pricesReconciled: 7,
    }));
    const { runPipeline } = await import("../src/pipeline.js");

    const result = await runPipeline(
      cerberusAdapter([
        file("stores", RAMI_LEVY),
        file("pricesfull", RAMI_LEVY),
        file("stores", YOHANANOF),
        file("pricesfull", YOHANANOF),
      ]),
    );

    expect(result.pricesReconciled).toBe(28);
  });
});
