import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
  withTransaction: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(): void {}
    async connect(): Promise<void> {}
    async close(): Promise<void> {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    async handleRequest(_request: unknown, response: {
      writeHead: (status: number, headers: Record<string, string>) => void;
      end: (body: string) => void;
    }): Promise<void> {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", result: {}, id: 1 }));
    }
    async close(): Promise<void> {}
  },
}));

import { buildApp } from "../src/app.js";
import { ANONYMOUS_API_KEY_ID, _resetRateLimitForTests } from "../src/auth.js";

const MCP_CALL = { jsonrpc: "2.0", method: "tools/list", id: 1 } as const;

function usageInsertKeyIds(): unknown[] {
  return query.mock.calls
    .filter(([sql]) => String(sql).includes("INSERT INTO usage_event"))
    .map(([, params]) => (Array.isArray(params) ? params[0] : null));
}

describe("keyless access through the running app", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    _resetRateLimitForTests();
    delete process.env.SUPER_MCP_ALLOW_ANONYMOUS;
    delete process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT;
    delete process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT;
  });

  it("answers MCP without any credential and meters it against the anonymous identity", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/mcp", payload: MCP_CALL });

    expect(response.statusCode).toBe(200);
    expect(usageInsertKeyIds()).toContain(ANONYMOUS_API_KEY_ID);
    await app.close();
  });

  it("keeps demanding a key when the switch is off", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/mcp", payload: MCP_CALL });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("locks anonymous callers out of key administration", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/v1/admin/keys" });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keeps a deliberately closed /ready closed to keyless callers", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_READY_REQUIRE_AUTH = "1";
    const app = await buildApp();

    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(401);
    } finally {
      delete process.env.SUPER_MCP_READY_REQUIRE_AUTH;
      await app.close();
    }
  });

  it("counts the forwarded client address, not the proxy hop", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "1";
    const app = await buildApp();

    const first = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "x-forwarded-for": "198.51.100.4" },
      payload: MCP_CALL,
    });
    const repeat = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "x-forwarded-for": "198.51.100.4" },
      payload: MCP_CALL,
    });
    const otherClient = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "x-forwarded-for": "198.51.100.5" },
      payload: MCP_CALL,
    });

    expect(first.statusCode).toBe(200);
    expect(repeat.statusCode).toBe(429);
    expect(otherClient.statusCode).toBe(200);
    await app.close();
  });
});
