import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const captureSafe = vi.fn();

vi.mock("@super-mcp/db", async () => {
  const { buildOntologySnapshot } = await import("@super-mcp/shared");
  return {
    query: (...args: unknown[]) => query(...args),
    withTransaction: vi.fn(),
    getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
    // Empty snapshot so a successful keyless /v1/products hit does not warn about ontology.
    loadOntologySnapshot: vi.fn(async () =>
      buildOntologySnapshot({ version: "test", locale: "he", terms: [] }),
    ),
  };
});

vi.mock("../../src/analytics/posthog.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/analytics/posthog.js")>(
    "../../src/analytics/posthog.js",
  );
  return { ...actual, captureSafe };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(): void {}
    async connect(): Promise<void> {}
    async close(): Promise<void> {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    async handleRequest(
      _request: unknown,
      response: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body: string) => void;
      },
    ): Promise<void> {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", result: {}, id: 1 }));
    }
    async close(): Promise<void> {}
  },
}));

const { buildApp } = await import("../../src/app.js");
const { _resetRateLimitForTests } = await import("../../src/auth.js");
const { _resetAccessRateLimitForTests } = await import("../../src/routes/access/index.js");

/** Every api_operation the app reported, as {distinctId, props}. */
function operations(): Array<{ distinctId: string; props: Record<string, unknown> }> {
  return captureSafe.mock.calls
    .filter((call) => call[1] === "api_operation")
    .map((call) => ({
      distinctId: call[0] as string,
      props: call[2] as Record<string, unknown>,
    }));
}

describe("auth rejections reach PostHog", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    process.env.TRUST_PROXY = "0";
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    captureSafe.mockClear();
    _resetRateLimitForTests();
    _resetAccessRateLimitForTests();
    delete process.env.SUPER_MCP_ALLOW_ANONYMOUS;
    delete process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT;
    delete process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT;
  });

  it("reports a keyless MCP call refused by a key-only deployment", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", method: "tools/list", id: 1 },
      headers: { "user-agent": "Cursor/1.0" },
    });

    expect(response.statusCode).toBe(401);
    // The install-funnel failure the whole change exists to make visible.
    const [op] = operations();
    expect(op).toBeDefined();
    expect(op!.props).toMatchObject({
      surface: "mcp",
      auth_mode: "rejected",
      http_status: 401,
      credential_presented: false,
      client_name: "cursor",
    });
    expect(op!.distinctId).toMatch(/^anon:[0-9a-f]{16}$/);
    await app.close();
  });

  it("reports a REST call with no credential", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/v1/products?query=milk" });

    expect(response.statusCode).toBe(401);
    expect(operations()[0]?.props).toMatchObject({
      surface: "rest",
      auth_mode: "rejected",
      credential_presented: false,
    });
    await app.close();
  });

  it("marks a rejected request that did carry a credential", async () => {
    query.mockResolvedValue({ rows: [] }); // no matching key row -> 401
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/products?query=milk",
      headers: { authorization: "Bearer smcp_not_a_real_key" },
    });

    expect(response.statusCode).toBe(401);
    expect(operations()[0]?.props).toMatchObject({ credential_presented: true });
    await app.close();
  });

  it("reports a keyless REST caller rejected by the anonymous rate limit", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "1";
    process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT = "100";
    const app = await buildApp();

    const first = await app.inject({ method: "GET", url: "/v1/products?query=milk" });
    const rejected = await app.inject({ method: "GET", url: "/v1/products?query=milk" });

    expect(first.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(429);
    const rejection = operations().find((op) => op.props.http_status === 429);
    expect(rejection?.props).toMatchObject({
      surface: "rest",
      auth_mode: "rejected",
      error_code: "rate_limited",
      credential_presented: false,
    });
    expect(rejection?.distinctId).toMatch(/^anon:[0-9a-f]{16}$/);
    await app.close();
  });

  it("does not invent an auth rejection for a public route's own 429", async () => {
    const app = await buildApp();

    // /v1/access-requests never authenticates; its 429 is a form-spam limit, and reporting it
    // as an auth rejection would show a connection failure that never happened.
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/access-requests",
        payload: { email: `user${i}@example.com`, use_case: "shopping" },
      });
      last = response.statusCode;
    }

    expect(last).toBe(429);
    expect(operations()).toHaveLength(0);
    await app.close();
  });

  it("still captures a successful keyless call under a per-caller identity", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/products?query=milk",
      headers: { "user-agent": "claude-code/1.0" },
    });

    expect(response.statusCode).toBe(200);
    const [op] = operations();
    expect(op!.props).toMatchObject({ auth_mode: "anonymous", client_name: "claude-code" });
    expect(op!.distinctId).toMatch(/^anon:[0-9a-f]{16}$/);
    await app.close();
  });
});
