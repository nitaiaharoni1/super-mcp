import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const withTransaction = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
  withTransaction: (...args: unknown[]) => withTransaction(...args),
}));

import { buildApp } from "../src/app.js";

const standardRow = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "standard",
  role: "standard",
  rate_limit_per_minute: 60,
};

const masterRow = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "master",
  role: "master",
  // High enough that suite requests against the shared in-memory limiter do not 429.
  rate_limit_per_minute: 6_000,
};

describe("master administration routes", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    withTransaction.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("denies a standard key before key administration executes", async () => {
    query.mockResolvedValueOnce({ rows: [standardRow] });
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/keys",
      headers: { authorization: "Bearer smcp_standard" },
    });

    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("privileged_audit_event"))).toBe(false);
    await app.close();
  });

  it("denies a standard key access to global usage", async () => {
    query.mockResolvedValueOnce({ rows: [standardRow] });
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/usage",
      headers: { authorization: "Bearer smcp_standard" },
    });

    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM usage_event"))).toBe(false);
    await app.close();
  });

  it("rejects minting master keys over HTTP (CLI break-glass only)", async () => {
    query
      .mockResolvedValueOnce({ rows: [masterRow] })
      .mockResolvedValueOnce({ rows: [{ id: "audit-id" }] })
      .mockResolvedValue({ rows: [] });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/keys?ignored=not-a-secret",
      headers: { authorization: "Bearer smcp_master" },
      payload: { name: "next-master", role: "master", expiresAt: "2026-08-01T00:00:00Z" },
    });

    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO api_key"))).toBe(false);
    await app.close();
  });

  it("audits before creating a standard key and returns its raw value once", async () => {
    query
      .mockResolvedValueOnce({ rows: [masterRow] })
      .mockResolvedValueOnce({ rows: [{ id: "audit-id" }] })
      .mockResolvedValueOnce({ rows: [{ id: "new-id", created_at: "2026-07-17T00:00:00Z" }] })
      .mockResolvedValue({ rows: [] });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/keys?ignored=not-a-secret",
      headers: { authorization: "Bearer smcp_master" },
      payload: { name: "agent-key", role: "standard", expiresAt: "2026-08-01T00:00:00Z" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.apiKey).toMatch(/^smcp_/);
    expect(String(query.mock.calls[1]?.[0])).toContain("privileged_audit_event");
    expect(String(query.mock.calls[2]?.[0])).toContain("INSERT INTO api_key");
    expect(query.mock.calls[1]?.[1]).toEqual([
      masterRow.id,
      "POST",
      "/v1/admin/keys",
    ]);
    await app.close();
  });

  it("finalizes an audited handler error without exposing database details", async () => {
    query
      .mockResolvedValueOnce({ rows: [masterRow] })
      .mockResolvedValueOnce({ rows: [{ id: "audit-id" }] })
      .mockRejectedValueOnce(new Error("secret database detail"))
      .mockResolvedValue({ rows: [] });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/keys",
      headers: { authorization: "Bearer smcp_master" },
      payload: { name: "broken", role: "standard" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret database detail");
    const finalize = query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE privileged_audit_event"));
    expect(finalize?.[1]).toEqual(["audit-id", 500, expect.any(Number), "internal_error"]);
    await app.close();
  });

  it("fails closed before a privileged handler when audit insertion fails", async () => {
    query
      .mockResolvedValueOnce({ rows: [masterRow] })
      .mockRejectedValueOnce(new Error("audit unavailable"));
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/keys",
      headers: { authorization: "Bearer smcp_master" },
      payload: { name: "must-not-exist", role: "standard" },
    });

    expect(response.statusCode).toBe(500);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO api_key"))).toBe(false);
    await app.close();
  });
});
