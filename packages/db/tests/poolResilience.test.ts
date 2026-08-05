/**
 * A dropped idle connection must not end the process.
 *
 * `pg` emits 'error' on the Pool when a client sitting idle dies, and Node
 * rethrows an 'error' event that has no listener as an uncaught exception. It is
 * not raised at a query, so no try/catch can see it. On 2026-08-05 every
 * connection from the laibcatalog ingest was reset at once and the job exited 1
 * twenty minutes in, losing hours of remaining work and both of its retries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PoolMock, instances } = vi.hoisted(() => {
  const instances: Array<{ handlers: Record<string, Array<(e: unknown) => void>> }> = [];
  class PoolMock {
    handlers: Record<string, Array<(e: unknown) => void>> = {};
    constructor() {
      instances.push(this);
    }
    on(event: string, fn: (e: unknown) => void) {
      (this.handlers[event] ??= []).push(fn);
      return this;
    }
  }
  return { PoolMock, instances };
});

vi.mock("pg", () => ({ default: { Pool: PoolMock } }));

describe("database pool resilience", () => {
  beforeEach(() => {
    instances.length = 0;
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/db";
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers an idle-client error handler", async () => {
    const { getPool } = await import("../src/client/index.js");
    getPool();

    expect(instances).toHaveLength(1);
    expect(instances[0]!.handlers["error"] ?? []).toHaveLength(1);
  });

  it("swallows an idle drop instead of letting Node rethrow it", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getPool } = await import("../src/client/index.js");
    getPool();

    const handler = instances[0]!.handlers["error"]![0]!;
    // The exact shape pg emits when Cloud SQL resets an idle connection.
    expect(() => handler(new Error("Connection terminated unexpectedly"))).not.toThrow();

    const logged = JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(logged.severity).toBe("WARNING");
    expect(String(logged.err)).toContain("Connection terminated");
  });
});
