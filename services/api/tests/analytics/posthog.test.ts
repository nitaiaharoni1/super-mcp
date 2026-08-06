import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { deriveClientName } from "../../src/analytics/metadata.js";
import {
  _resetPostHogClientForTests,
  captureSafe,
  getPostHogClient,
  posthogDistinctId,
} from "../../src/analytics/posthog.js";
import { ANONYMOUS_API_KEY_ID, anonymousAnalyticsId } from "../../src/auth.js";

describe("posthog client", () => {
  afterEach(() => {
    delete process.env.POSTHOG_KEY;
    _resetPostHogClientForTests();
  });

  it("returns null client when POSTHOG_KEY is unset", () => {
    delete process.env.POSTHOG_KEY;
    _resetPostHogClientForTests();
    expect(getPostHogClient()).toBeNull();
  });

  it("captureSafe never throws without a key", () => {
    delete process.env.POSTHOG_KEY;
    _resetPostHogClientForTests();
    expect(() =>
      captureSafe("api_key:test", "api_operation", { surface: "mcp", operation: "search_products" }),
    ).not.toThrow();
  });

  it("builds stable distinct ids from api key ids", () => {
    expect(posthogDistinctId("abc-123")).toBe("api_key:abc-123");
  });

  it("prefers the analytics id so keyless callers are not one shared person", () => {
    expect(posthogDistinctId(ANONYMOUS_API_KEY_ID, "anon:deadbeefdeadbeef")).toBe(
      "anon:deadbeefdeadbeef",
    );
  });

  it("falls back to the key id when the analytics id is blank", () => {
    expect(posthogDistinctId("abc-123", "   ")).toBe("api_key:abc-123");
  });
});

describe("anonymousAnalyticsId", () => {
  const requestFor = (ip: string, ua?: string) =>
    ({ ip, headers: ua ? { "user-agent": ua } : {} }) as unknown as FastifyRequest;

  it("is stable for the same address and agent", () => {
    const a = anonymousAnalyticsId(requestFor("1.2.3.4", "cursor/1.0"));
    expect(anonymousAnalyticsId(requestFor("1.2.3.4", "cursor/1.0"))).toBe(a);
    expect(a).toMatch(/^anon:[0-9a-f]{16}$/);
  });

  it("separates different callers", () => {
    expect(anonymousAnalyticsId(requestFor("1.2.3.4", "cursor/1.0"))).not.toBe(
      anonymousAnalyticsId(requestFor("5.6.7.8", "cursor/1.0")),
    );
    expect(anonymousAnalyticsId(requestFor("1.2.3.4", "cursor/1.0"))).not.toBe(
      anonymousAnalyticsId(requestFor("1.2.3.4", "gemini-cli/2.0")),
    );
  });

  it("never leaks the raw address or agent into the id", () => {
    const id = anonymousAnalyticsId(requestFor("203.0.113.9", "Cursor/1.0"));
    expect(id).not.toContain("203.0.113.9");
    expect(id.toLowerCase()).not.toContain("cursor");
  });
});

describe("deriveClientName", () => {
  it("buckets agents to the same ids the install cards report", () => {
    expect(deriveClientName("Cursor/1.2 (darwin)")).toBe("cursor");
    expect(deriveClientName("node", "claude-code")).toBe("claude-code");
    expect(deriveClientName("Claude-User/1.0")).toBe("claude");
    expect(deriveClientName("ChatGPT-User/1.0")).toBe("chatgpt");
    expect(deriveClientName(undefined, "Visual Studio Code")).toBe("vscode");
    expect(deriveClientName("vscode/1.96.0")).toBe("vscode");
    expect(deriveClientName(undefined, "LM Studio")).toBe("lmstudio");
    expect(deriveClientName("gemini-cli/0.4")).toBe("gemini-cli");
  });

  it("prefers the handshake name over the http stack's agent", () => {
    expect(deriveClientName("node-fetch/1.0", "cursor-vscode")).toBe("cursor");
  });

  it("lets the handshake win even when the agent matches an earlier pattern", () => {
    // Merging both into one haystack filed this as "cursor", because cursor is tested first.
    expect(deriveClientName("Cursor/1.0", "gemini-cli")).toBe("gemini-cli");
  });

  it("falls back to the agent only when the handshake is unrecognised", () => {
    expect(deriveClientName("Cursor/1.0", "some-homegrown-agent")).toBe("cursor");
  });

  it("separates unknown from merely unrecognised", () => {
    expect(deriveClientName(undefined)).toBe("unknown");
    expect(deriveClientName("   ")).toBe("unknown");
    expect(deriveClientName("curl/8.4.0")).toBe("other");
  });
});
