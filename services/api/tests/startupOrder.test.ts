import { describe, expect, it, vi } from "vitest";

/**
 * The embedding model must be resident BEFORE the port opens.
 *
 * This exact spot has regressed twice. First there was no effective warm at all
 * (it called the cache-first getQueryEmbedding, which returned a stored vector and
 * loaded nothing). Then the warm was fired after listen(), where Cloud Run throttles
 * CPU outside a request, so it took 63s of wall clock and the first real request paid
 * ~12s anyway. Both bugs are invisible to a unit test of the warm function itself,
 * because both were about WHEN it runs, so the ordering gets its own test.
 */

const calls: string[] = [];
const listen = vi.fn(async () => {
  calls.push("listen");
});
const warmEmbeddingModel = vi.fn(async () => {
  calls.push("warm");
});

vi.mock("../src/app.js", () => ({
  buildApp: async () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    listen,
    close: vi.fn(async () => undefined),
  }),
}));

vi.mock("../src/services/search/queryEmbedding.js", () => ({
  warmEmbeddingModel: () => warmEmbeddingModel(),
}));

describe("API startup order", () => {
  it("warms the embedding model before opening the port", async () => {
    // main() calls process.exit(1) on an unexpected throw, which would take vitest
    // down with it; make that observable instead of fatal.
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) during startup`);
    }) as never);

    try {
      await import("../src/index.js");
      await vi.waitFor(() => expect(calls).toContain("listen"), { timeout: 5000 });

      expect(calls).toEqual(["warm", "listen"]);
      expect(warmEmbeddingModel).toHaveBeenCalledTimes(1);
    } finally {
      exit.mockRestore();
    }
  });
});
