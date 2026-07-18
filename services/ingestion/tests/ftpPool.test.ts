import { describe, expect, it } from "vitest";
import { FtpPool } from "../src/sources/common/ftpPool.js";

describe("FtpPool waiter handling", () => {
  it(
    "rejects a queued waiter when reconnection fails, instead of hanging",
    async () => {
      let connects = 0;
      const pool = new FtpPool(1, async () => {
        connects++;
        if (connects > 1) throw new Error("reconnect refused");
      });

      // Occupy the single slot, then queue a waiter, then break the held client.
      // The waiter can only settle AFTER the held client breaks and pumps
      // waiters, so capture the assertion (don't await it) before throwing.
      let waiterAssertion!: Promise<void>;
      const releaseHeld = pool.withClient(async () => {
        const waiter = pool.withClient(async () => "never");
        // Give the waiter a tick to enqueue.
        await new Promise((r) => setTimeout(r, 10));
        waiterAssertion = expect(waiter).rejects.toThrow(/reconnect refused|acquire/i);
        // Breaking out of withClient with an error closes the client and pumps waiters.
        throw new Error("break connection");
      });
      await expect(releaseHeld).rejects.toThrow("break connection");
      // The stranded waiter must reject (the bug: it was silently dropped).
      await waiterAssertion;
    },
    3000,
  );
});
