/**
 * A failing MCP tool must leave a trace on the server.
 *
 * `errorResult` gives the caller "Internal server error" and nothing else, which
 * is correct (pg text must not reach a client) but was previously the whole
 * story: an unexpected failure was written nowhere at any severity. get_promotions
 * was dead for every browse call in production and no log line existed to say so.
 * These tests pin the log, not the client reply, because the client reply was
 * never the part that was broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@super-mcp/shared";

vi.mock("../../../src/analytics/capture.js", () => ({ captureMcpToolOperation: vi.fn() }));
vi.mock("../../../src/analytics/context.js", () => ({ resolveAnalyticsContext: vi.fn(() => ({})) }));

import { registerTool } from "../../../src/mcp/tools/register.js";

type Handler = (args: unknown) => Promise<unknown>;

/** Minimal stand-in for McpServer that just captures the wrapped handler. */
function fakeServer(): { server: { registerTool: (n: string, m: unknown, h: Handler) => void }; handler: () => Handler } {
  let captured: Handler | null = null;
  return {
    server: { registerTool: (_n, _m, h) => { captured = h; } },
    handler: () => {
      if (!captured) throw new Error("tool was never registered");
      return captured;
    },
  };
}

function register(fail: unknown) {
  const { server, handler } = fakeServer();
  registerTool(
    server as never,
    "get_promotions",
    { title: "t", description: "d", inputSchema: {} as z.ZodRawShape },
    async () => {
      throw fail;
    },
  );
  return handler();
}

describe("registerTool failure logging", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  function loggedEntry(): Record<string, unknown> {
    expect(errSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
  }

  // The real regression: a driver error, invisible before this change.
  it("logs an unexpected error at ERROR with its stack and the tool name", async () => {
    const handler = register(new Error("could not determine data type of parameter $2"));
    const res = (await handler({})) as { isError?: true; content: Array<{ text: string }> };

    const entry = loggedEntry();
    expect(entry.severity).toBe("ERROR");
    expect(entry.tool).toBe("get_promotions");
    expect(entry.errMessage).toContain("could not determine data type");
    expect(typeof entry.stack).toBe("string");

    // The client still learns nothing about the database.
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe("Error: Internal server error");
    expect(res.content[0]!.text).not.toContain("parameter $2");
  });

  // Expected client errors must not burn the error budget or page anyone.
  it("logs an AppError at WARNING and omits the stack", async () => {
    const handler = register(new AppError("rate_limited", "too many requests", 429));
    await handler({});

    const entry = loggedEntry();
    expect(entry.severity).toBe("WARNING");
    expect(entry.errMessage).toBe("too many requests");
    expect(entry).not.toHaveProperty("stack");
  });

  it("survives a thrown non-Error", async () => {
    const handler = register("boom");
    await handler({});

    const entry = loggedEntry();
    expect(entry.severity).toBe("ERROR");
    expect(entry.errMessage).toBe("boom");
  });

  it("never writes the caller's arguments to the log", async () => {
    const { server, handler } = fakeServer();
    registerTool(
      server as never,
      "optimize_delivery",
      { title: "t", description: "d", inputSchema: {} as z.ZodRawShape },
      async () => {
        throw new Error("nope");
      },
    );
    await handler()({ address: "דיזנגוף 100, תל אביב", items: [{ query: "חלב" }] });

    const raw = errSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("דיזנגוף");
    expect(raw).not.toContain("חלב");
  });

  it("stays silent when the tool succeeds", async () => {
    const { server, handler } = fakeServer();
    registerTool(
      server as never,
      "search_products",
      { title: "t", description: "d", inputSchema: {} as z.ZodRawShape },
      async () => ({ ok: true }),
    );
    await handler()({});

    expect(errSpy).not.toHaveBeenCalled();
  });
});
