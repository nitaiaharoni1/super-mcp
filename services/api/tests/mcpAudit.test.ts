import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
let transportError: Error | null = null;

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
      if (transportError) throw transportError;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", result: {}, id: 1 }));
    }
    async close(): Promise<void> {}
  },
}));

import { buildApp } from "../src/app.js";

const masterRow = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "master",
  role: "master",
  rate_limit_per_minute: 6_000,
};

describe("MCP master auditing", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    transportError = null;
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it("durably audits the close path", async () => {
    query
      .mockResolvedValueOnce({ rows: [masterRow] })
      .mockResolvedValueOnce({ rows: [{ id: "audit-id" }] });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer smcp_master" },
      payload: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[1]?.[1]).toEqual([masterRow.id, "POST", "/mcp"]);
    expect(
      query.mock.calls.some(
        ([sql, params]) =>
          String(sql).startsWith("UPDATE privileged_audit_event") &&
          Array.isArray(params) &&
          params[1] === 200,
      ),
    ).toBe(true);
    await app.close();
  });

  it("finalizes MCP transport errors with an opaque error code", async () => {
    transportError = new Error("transport secret");
    query
      .mockResolvedValueOnce({ rows: [masterRow] })
      .mockResolvedValueOnce({ rows: [{ id: "audit-id" }] });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer smcp_master" },
      payload: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("transport secret");
    expect(
      query.mock.calls.some(
        ([sql, params]) =>
          String(sql).startsWith("UPDATE privileged_audit_event") &&
          Array.isArray(params) &&
          params[1] === 500 &&
          params[3] === "internal_error",
      ),
    ).toBe(true);
    await app.close();
  });
});
