import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
  getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
}));

import { buildApp } from "../src/app.js";
import { _resetAccessRateLimitForTests } from "../src/routes/access/index.js";

describe("POST /v1/access-requests", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    process.env.TRUST_PROXY = "0";
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    _resetAccessRateLimitForTests();
  });

  afterEach(async () => {
    _resetAccessRateLimitForTests();
    vi.restoreAllMocks();
  });

  it("accepts a public request without an API key and inserts a row", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/access-requests",
      payload: { email: "User@Example.com", use_case: "Claude shopping agent" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { received: true } });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO access_requests"),
      ["user@example.com", "Claude shopping agent"],
    );
    await app.close();
  });

  it("stores null use_case when omitted or blank", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/access-requests",
      payload: { email: "a@b.co", use_case: "   " },
    });

    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO access_requests"), [
      "a@b.co",
      null,
    ]);
    await app.close();
  });

  it("rejects invalid email with 400", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/access-requests",
      payload: { email: "not-an-email" },
    });

    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it("rate-limits after five submissions from the same IP", async () => {
    const app = await buildApp();

    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({
        method: "POST",
        url: "/v1/access-requests",
        payload: { email: `user${i}@example.com` },
      });
      expect(ok.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/access-requests",
      payload: { email: "sixth@example.com" },
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");
    expect(query).toHaveBeenCalledTimes(5);
    await app.close();
  });

  it("does not treat a spoofed X-Forwarded-For as a new client when trustProxy is off", async () => {
    const app = await buildApp();

    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({
        method: "POST",
        url: "/v1/access-requests",
        headers: { "x-forwarded-for": `203.0.113.${i}` },
        payload: { email: `user${i}@example.com` },
      });
      expect(ok.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/access-requests",
      headers: { "x-forwarded-for": "198.51.100.9" },
      payload: { email: "sixth@example.com" },
    });

    expect(limited.statusCode).toBe(429);
    await app.close();
  });
});
