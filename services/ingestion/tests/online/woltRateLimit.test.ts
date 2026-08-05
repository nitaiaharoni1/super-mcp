/**
 * A 429 from Wolt must be waited out, not counted as a failure.
 *
 * Wolt rate-limits on sustained volume rather than burst, so lowering concurrency
 * alone was measured insufficient: a 93-page run at 8 concurrent saw zero 429s,
 * while the 907-page allowlisted run at 4 concurrent took 680 rejections and left
 * Wolt Market and Victory with zero price rows each. A run that silently drops
 * whole brands is worse than one that fails, because those venues keep their store
 * rows and a store row alone becomes an orderable storefront with nothing in it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAllowedFeed } = vi.hoisted(() => ({ fetchAllowedFeed: vi.fn() }));
vi.mock("../../src/sources/common/allowedFetch.js", () => ({ fetchAllowedFeed }));

import { createWoltAdapter } from "../../src/online/sources/wolt/adapter.js";

function ok(body: string) {
  return { ok: true, status: 200, headers: new Headers(), text: async () => body };
}
function rateLimited(retryAfter?: string) {
  const headers = new Headers();
  if (retryAfter) headers.set("retry-after", retryAfter);
  return { ok: false, status: 429, headers, text: async () => "" };
}
function failed(status: number) {
  return { ok: false, status, headers: new Headers(), text: async () => "" };
}

const FILE = {
  sourceId: "il-wolt",
  kind: "prices" as const,
  remotePath: "https://wolt.com/he/isr/tel-aviv/venue/v/items/menucategory-1",
  fileName: "v--menucategory-1.html",
  chainId: "IL-WOLT-VICTORY",
  storeId: "v",
};

describe("Wolt fetch under rate limiting", () => {
  beforeEach(() => {
    fetchAllowedFeed.mockReset();
    // Any call beyond what a case queues explicitly resolves rather than
    // returning undefined, so a stray attempt cannot surface as an unhandled
    // TypeError that looks like a product bug.
    fetchAllowedFeed.mockResolvedValue(ok("<html>default</html>"));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Start the fetch and hand back the promise WITHOUT awaiting timers yet, so the
   * caller can attach its expectation first. Draining timers before a handler
   * exists makes a legitimately-rejecting case surface as an unhandled rejection.
   */
  function startFetch(): Promise<string> {
    const adapter = createWoltAdapter();
    return adapter.fetch(FILE as never).then((blob) => blob.bytes.toString("utf8"));
  }

  /** Attach the expectation, then let the backoff timers run. */
  async function settle<T>(assertion: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return assertion;
  }

  it("retries after a 429 and returns the eventual body", async () => {
    fetchAllowedFeed
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(ok("<html>items</html>"));

    await settle(expect(startFetch()).resolves.toContain("items"));
    expect(fetchAllowedFeed).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After when Wolt sends one", async () => {
    fetchAllowedFeed
      .mockResolvedValueOnce(rateLimited("2"))
      .mockResolvedValueOnce(ok("<html>ok</html>"));

    await settle(expect(startFetch()).resolves.toContain("ok"));
    expect(fetchAllowedFeed).toHaveBeenCalledTimes(2);
  });

  it("gives up after a bounded number of attempts rather than hanging a run", async () => {
    fetchAllowedFeed.mockReset();
    fetchAllowedFeed.mockResolvedValue(rateLimited());

    await settle(expect(startFetch()).rejects.toThrow(/429/));
    // Bounded: not one attempt, and not unbounded either.
    expect(fetchAllowedFeed.mock.calls.length).toBeGreaterThan(1);
    expect(fetchAllowedFeed.mock.calls.length).toBeLessThanOrEqual(6);
  });

  // Retrying these would multiply exactly the volume that caused the throttling.
  it("does not retry statuses that will not improve", async () => {
    fetchAllowedFeed.mockReset();
    fetchAllowedFeed.mockResolvedValue(failed(404));

    await settle(expect(startFetch()).rejects.toThrow(/404/));
    expect(fetchAllowedFeed).toHaveBeenCalledTimes(1);
  });

  it("does not retry a page that succeeded first time", async () => {
    fetchAllowedFeed.mockResolvedValueOnce(ok("<html>first</html>"));

    await settle(expect(startFetch()).resolves.toContain("first"));
    expect(fetchAllowedFeed).toHaveBeenCalledTimes(1);
  });
});
