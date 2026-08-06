import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const query = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import {
  ANONYMOUS_API_KEY_ID,
  MAX_ANONYMOUS_IP_BUCKETS,
  authenticate,
  authorize,
  extractApiKey,
  resolveApiKey,
  _anonymousBucketCountForTests,
  _resetRateLimitForTests,
  type AuthContext,
} from "../src/auth.js";

function request(input: {
  authorization?: string;
  query?: Record<string, unknown>;
  url?: string;
  ip?: string;
} = {}): FastifyRequest {
  return {
    headers: { authorization: input.authorization },
    query: input.query ?? {},
    url: input.url ?? "/v1/products",
    ip: input.ip ?? "203.0.113.10",
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

describe("keyless (anonymous) access", () => {
  beforeEach(() => {
    query.mockReset();
    _resetRateLimitForTests();
    delete process.env.SUPER_MCP_ALLOW_ANONYMOUS;
    delete process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT;
    delete process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT;
  });

  it("still rejects a keyless request when anonymous access is off", async () => {
    await expect(authenticate(request())).rejects.toMatchObject({ statusCode: 401 });
  });

  it("serves a keyless request as the seeded anonymous identity, without touching the database", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";

    await expect(authenticate(request())).resolves.toEqual({
      apiKeyId: ANONYMOUS_API_KEY_ID,
      name: "anonymous",
      role: "standard",
      rateLimitPerMinute: 30,
      // Keyless callers share one api key id, so analytics identifies them by this instead.
      analyticsId: expect.stringMatching(/^anon:[0-9a-f]{16}$/),
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("never downgrades an invalid key to anonymous", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    query.mockResolvedValue({ rows: [] });

    await expect(authenticate(request({ authorization: "Bearer smcp_revoked" }))).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("grants anonymous callers shopping only, never administration", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    const auth = await authenticate(request());

    expect(() => authorize(auth, "shopping")).not.toThrow();
    expect(() => authorize(auth, "key_admin")).toThrowError(/Master API key required/);
    expect(() => authorize(auth, "global_usage")).toThrowError(/Master API key required/);
  });

  it("rate-limits each client address independently", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "2";

    await authenticate(request({ ip: "198.51.100.1" }));
    await authenticate(request({ ip: "198.51.100.1" }));
    await expect(authenticate(request({ ip: "198.51.100.1" }))).rejects.toMatchObject({
      statusCode: 429,
      details: { scope: "anonymous_ip", limitPerMinute: 2 },
    });

    await expect(authenticate(request({ ip: "198.51.100.2" }))).resolves.toMatchObject({
      apiKeyId: ANONYMOUS_API_KEY_ID,
    });
  });

  it("caps total anonymous traffic across addresses", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "10";
    process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT = "3";

    for (let i = 0; i < 3; i += 1) {
      await authenticate(request({ ip: `198.51.100.${i}` }));
    }

    await expect(authenticate(request({ ip: "198.51.100.99" }))).rejects.toMatchObject({
      statusCode: 429,
      details: { scope: "anonymous_total", limitPerMinute: 3 },
    });
  });

  it("does not let one flooding address spend the shared ceiling", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "1";
    process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT = "4";

    for (let i = 0; i < 20; i += 1) {
      await authenticate(request({ ip: "198.51.100.7" })).catch(() => undefined);
    }

    // The flood burned exactly one slot of the shared ceiling, so three remain for everyone else.
    for (let i = 0; i < 3; i += 1) {
      await expect(authenticate(request({ ip: `203.0.113.${i}` }))).resolves.toMatchObject({
        apiKeyId: ANONYMOUS_API_KEY_ID,
      });
    }
    await expect(authenticate(request({ ip: "203.0.113.200" }))).rejects.toMatchObject({
      statusCode: 429,
      details: { scope: "anonymous_total" },
    });
  });

  it("stops minting per-address windows once an address-rotating flood fills the map", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "1";
    process.env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT = "100000";

    for (let i = 0; i < MAX_ANONYMOUS_IP_BUCKETS; i += 1) {
      await authenticate(request({ ip: `10.0.${Math.floor(i / 256)}.${i % 256}` }));
    }
    expect(_anonymousBucketCountForTests()).toBe(MAX_ANONYMOUS_IP_BUCKETS);

    // A fresh address is served under the shared ceiling alone, and adds no entry.
    await expect(authenticate(request({ ip: "192.0.2.55" }))).resolves.toMatchObject({
      apiKeyId: ANONYMOUS_API_KEY_ID,
    });
    expect(_anonymousBucketCountForTests()).toBe(MAX_ANONYMOUS_IP_BUCKETS);

    // Addresses already tracked stay limited.
    await expect(authenticate(request({ ip: "10.0.0.5" }))).rejects.toMatchObject({
      statusCode: 429,
      details: { scope: "anonymous_ip" },
    });
    // 20k authentications against a deliberately huge global ceiling, so the shared window keeps
    // growing and every call re-filters it. ~3s alone, and it overran the 5s default whenever the
    // suite ran in parallel. Production never sees this: the real ceiling bounds that window.
  }, 30_000);

  it("falls back to the documented defaults when the limit variables are junk", async () => {
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    process.env.SUPER_MCP_ANONYMOUS_RATE_LIMIT = "not-a-number";

    await expect(authenticate(request())).resolves.toMatchObject({ rateLimitPerMinute: 30 });
  });
});
