import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  buildAccessMailto,
  buildMcpJsonSnippet,
  buildMcpServerConfig,
  getAccessEmail,
} from "@/lib/mcp";

describe("mcp helpers", () => {
  const url = "https://api.example.com/mcp";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds authenticated url+headers server config", () => {
    expect(buildMcpServerConfig(url)).toEqual({
      url,
      headers: { Authorization: `Bearer ${API_KEY_PLACEHOLDER}` },
    });
  });

  it("builds mcp.json snippet with Authorization placeholder", () => {
    const snippet = buildMcpJsonSnippet(url);
    const parsed = JSON.parse(snippet) as {
      mcpServers: { "super-mcp": { url: string; headers: { Authorization: string } } };
    };
    expect(parsed.mcpServers["super-mcp"].url).toBe(url);
    expect(parsed.mcpServers["super-mcp"].headers.Authorization).toBe(
      `Bearer ${API_KEY_PLACEHOLDER}`,
    );
    expect(snippet).not.toMatch(/sk-|Bearer [a-zA-Z0-9_-]{16,}/);
    expect(snippet).toContain(API_KEY_PLACEHOLDER);
  });

  it("builds access mailto with encoded Hebrew subject and body", () => {
    const href = buildAccessMailto("access@example.com");
    expect(href.startsWith("mailto:access%40example.com?")).toBe(true);
    expect(href).toContain("subject=");
    expect(href).toContain("body=");
    expect(decodeURIComponent(href)).toContain("בקשת גישה ל-Super MCP");
    expect(decodeURIComponent(href)).toContain("אשמח לקבל גישת MCP/API");
  });

  it("returns null when NEXT_PUBLIC_ACCESS_EMAIL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_EMAIL", "");
    expect(getAccessEmail()).toBeNull();
  });

  it("returns trimmed access email when set", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_EMAIL", "  keys@supermcp.example  ");
    expect(getAccessEmail()).toBe("keys@supermcp.example");
  });
});
