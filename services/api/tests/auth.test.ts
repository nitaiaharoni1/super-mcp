import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const query = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import {
  authenticate,
  authorize,
  extractApiKey,
  resolveApiKey,
  type AuthContext,
} from "../src/auth.js";

function request(input: {
  authorization?: string;
  query?: Record<string, unknown>;
  url?: string;
} = {}): FastifyRequest {
  return {
    headers: { authorization: input.authorization },
    query: input.query ?? {},
    url: input.url ?? "/v1/products",
    auth: null,
  } as unknown as FastifyRequest;
}

const standard: AuthContext = {
  apiKeyId: "standard-id",
  name: "standard",
  role: "standard",
  rateLimitPerMinute: 60,
};

const master: AuthContext = {
  apiKeyId: "master-id",
  name: "master",
  role: "master",
  rateLimitPerMinute: 1,
};

describe("API key authentication and authorization", () => {
  beforeEach(() => {
    query.mockReset();
    delete process.env.SUPER_MCP_ALLOW_MCP_QUERY_API_KEY;
  });

  it("rejects query-string credentials by default", () => {
    expect(extractApiKey(request({ query: { api_key: "smcp_secret" }, url: "/mcp" }))).toBeNull();
  });

  it("permits query credentials only for /mcp when compatibility is explicitly enabled", () => {
    process.env.SUPER_MCP_ALLOW_MCP_QUERY_API_KEY = "1";
    expect(extractApiKey(request({ query: { api_key: "smcp_secret" }, url: "/mcp?api_key=redacted" }))).toBe(
      "smcp_secret",
    );
    expect(
      extractApiKey(request({ query: { api_key: "smcp_secret" }, url: "/v1/products?api_key=redacted" })),
    ).toBeNull();
  });

  it("resolves role only for a non-revoked, non-expired key", async () => {
    query.mockResolvedValue({
      rows: [{ id: "key-id", name: "ops", role: "master", rate_limit_per_minute: 7 }],
    });

    await expect(resolveApiKey("smcp_raw")).resolves.toEqual({
      apiKeyId: "key-id",
      name: "ops",
      role: "master",
      rateLimitPerMinute: 7,
    });
    expect(query.mock.calls[0]?.[0]).toContain("expires_at");
    expect(query.mock.calls[0]?.[0]).toContain("revoked_at IS NULL");
  });

  it("allows standard keys to use shopping capabilities but denies administration", () => {
    expect(() => authorize(standard, "shopping")).not.toThrow();
    expect(() => authorize(standard, "key_admin")).toThrowError(/Master API key required/);
    expect(() => authorize(standard, "global_usage")).toThrowError(/Master API key required/);
  });

  it("allows master keys to use every protected capability", () => {
    expect(() => authorize(master, "shopping")).not.toThrow();
    expect(() => authorize(master, "key_admin")).not.toThrow();
    expect(() => authorize(master, "global_usage")).not.toThrow();
  });

  it("applies a finite default rate limit when a master key has rate_limit_per_minute 0", async () => {
    query.mockResolvedValue({
      rows: [{ id: "master-id", name: "master", role: "master", rate_limit_per_minute: 0 }],
    });
    const first = request({ authorization: "Bearer smcp_master" });
    const second = request({ authorization: "Bearer smcp_master" });

    await expect(authenticate(first)).resolves.toMatchObject({ role: "master" });
    await expect(authenticate(second)).resolves.toMatchObject({ role: "master" });
  });

  it("re-checks revocation and expiry on every request", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: "key-id", name: "agent", role: "standard", rate_limit_per_minute: 60 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(authenticate(request({ authorization: "Bearer smcp_key" }))).resolves.toMatchObject({
      apiKeyId: "key-id",
    });
    await expect(authenticate(request({ authorization: "Bearer smcp_key" }))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
