import { AppError } from "@super-mcp/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureSafe = vi.fn();

vi.mock("../../src/analytics/posthog.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/analytics/posthog.js")>(
    "../../src/analytics/posthog.js",
  );
  return { ...actual, captureSafe };
});

const { captureApiOperation, captureAuthRejection } = await import("../../src/analytics/capture.js");
const { ANONYMOUS_API_KEY_ID } = await import("../../src/auth.js");

function lastCall() {
  const call = captureSafe.mock.calls.at(-1);
  if (!call) throw new Error("captureSafe was not called");
  return { distinctId: call[0] as string, event: call[1] as string, props: call[2] as Record<string, unknown> };
}

describe("captureApiOperation", () => {
  beforeEach(() => {
    captureSafe.mockClear();
  });

  it("labels key holders api_key and identifies them by key id", () => {
    captureApiOperation({
      surface: "mcp",
      operation: "search_products",
      status: "ok",
      latencyMs: 12,
      apiKeyId: "key-1",
      apiKeyRole: "standard",
    });

    const { distinctId, props } = lastCall();
    expect(distinctId).toBe("api_key:key-1");
    expect(props.auth_mode).toBe("api_key");
  });

  it("labels the seeded keyless identity anonymous and splits it by analytics id", () => {
    captureApiOperation({
      surface: "mcp",
      operation: "search_products",
      status: "ok",
      latencyMs: 12,
      apiKeyId: ANONYMOUS_API_KEY_ID,
      apiKeyRole: "standard",
      analyticsId: "anon:abcdef0123456789",
      clientName: "cursor",
    });

    const { distinctId, props } = lastCall();
    // The whole point: keyless callers must not collapse into one PostHog person.
    expect(distinctId).toBe("anon:abcdef0123456789");
    expect(props.auth_mode).toBe("anonymous");
    expect(props.client_name).toBe("cursor");
  });

  it("omits client_name rather than sending an empty one", () => {
    captureApiOperation({
      surface: "rest",
      operation: "/v1/products",
      status: "ok",
      latencyMs: 3,
      apiKeyId: "key-1",
      apiKeyRole: "standard",
    });

    expect(lastCall().props).not.toHaveProperty("client_name");
  });
});

describe("captureAuthRejection", () => {
  beforeEach(() => {
    captureSafe.mockClear();
  });

  it("reports a refused key as a rejected api_operation, not silence", () => {
    captureAuthRejection({
      surface: "mcp",
      operation: "/mcp",
      startedAt: Date.now(),
      error: new AppError("unauthorized", "Missing API key", 401),
      analyticsId: "anon:abcdef0123456789",
      clientName: "chatgpt",
    });

    const { distinctId, event, props } = lastCall();
    expect(event).toBe("api_operation");
    expect(distinctId).toBe("anon:abcdef0123456789");
    expect(props).toMatchObject({
      auth_mode: "rejected",
      status: "error",
      http_status: 401,
      error_code: "unauthorized",
      api_key_role: "none",
      client_name: "chatgpt",
    });
  });

  it("carries the 429 through so a keyless caller over the ceiling is visible", () => {
    captureAuthRejection({
      surface: "mcp",
      operation: "/mcp",
      startedAt: Date.now(),
      error: new AppError("rate_limited", "Rate limit exceeded", 429),
      analyticsId: "anon:abcdef0123456789",
      clientName: "cursor",
    });

    expect(lastCall().props).toMatchObject({ http_status: 429, error_code: "rate_limited" });
  });

  it("separates a throttled key holder from the keyless cohort", () => {
    // A key holder over their limit throws before request.auth is set, so they reach the same
    // rejection path. They must not be readable as "an install config with no key".
    captureAuthRejection({
      surface: "rest",
      operation: "/v1/products",
      startedAt: Date.now(),
      error: new AppError("rate_limited", "Rate limit exceeded", 429),
      analyticsId: "anon:abcdef0123456789",
      clientName: "other",
      credentialPresented: true,
    });

    expect(lastCall().props).toMatchObject({
      auth_mode: "rejected",
      credential_presented: true,
      http_status: 429,
    });
  });

  it("marks a keyless rejection as carrying no credential", () => {
    captureAuthRejection({
      surface: "mcp",
      operation: "/mcp",
      startedAt: Date.now(),
      error: new AppError("unauthorized", "Missing API key", 401),
      analyticsId: "anon:abcdef0123456789",
      clientName: "chatgpt",
      credentialPresented: false,
    });

    expect(lastCall().props).toMatchObject({ credential_presented: false });
  });

  it("omits credential_presented when it was not determined", () => {
    captureApiOperation({
      surface: "rest",
      operation: "/v1/products",
      status: "ok",
      latencyMs: 3,
      apiKeyId: "key-1",
      apiKeyRole: "standard",
    });

    expect(lastCall().props).not.toHaveProperty("credential_presented");
  });

  it("falls back to a plain 401 for a non-AppError", () => {
    captureAuthRejection({
      surface: "rest",
      operation: "/v1/products",
      startedAt: Date.now(),
      error: new Error("boom"),
      analyticsId: "anon:abcdef0123456789",
      clientName: "other",
    });

    expect(lastCall().props).toMatchObject({ http_status: 401, error_code: "unauthorized" });
  });
});
