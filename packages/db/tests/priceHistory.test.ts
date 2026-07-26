/**
 * Price history is off by default.
 *
 * `price_point` exists for GET /v1/products/:id/history, which had been called
 * once in the service's lifetime against 2,209 /mcp calls. Writing it cost an
 * extra INSERT plus index maintenance on every changed price, and Cloud SQL disk
 * throughput scales with disk size: on the 20GB PD_SSD instance, a full ingest
 * held ~585 write ops/sec against a ~600 IOPS ceiling while CPU idled at 48%.
 * The append was spending the one resource that was actually exhausted.
 */
import { describe, expect, it, afterEach } from "vitest";
import { priceHistoryEnabled } from "../src/queries/priceHistory.js";

const previous = process.env.SUPER_MCP_PRICE_HISTORY;

afterEach(() => {
  if (previous === undefined) delete process.env.SUPER_MCP_PRICE_HISTORY;
  else process.env.SUPER_MCP_PRICE_HISTORY = previous;
});

describe("priceHistoryEnabled", () => {
  it("is off when unset, so a default deployment does not pay for it", () => {
    delete process.env.SUPER_MCP_PRICE_HISTORY;
    expect(priceHistoryEnabled()).toBe(false);
  });

  it("turns on with an explicit 1", () => {
    process.env.SUPER_MCP_PRICE_HISTORY = "1";
    expect(priceHistoryEnabled()).toBe(true);
  });

  it("treats any other value as off rather than guessing", () => {
    // "true"/"yes" deliberately do NOT enable it: a half-recognised flag is how
    // someone ends up believing history is being recorded when it is not.
    for (const v of ["0", "true", "yes", "", "on"]) {
      process.env.SUPER_MCP_PRICE_HISTORY = v;
      expect(priceHistoryEnabled(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});
