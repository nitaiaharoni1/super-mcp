import { afterEach, describe, expect, it } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  buildMcpJsonSnippet,
  buildMcpServerConfig,
  getApiBaseUrl,
  getMcpUrl,
} from "@/lib/mcp";

describe("mcp helpers", () => {
  const url = "https://api.example.com/mcp";
  const previousMcpUrl = process.env.NEXT_PUBLIC_MCP_URL;

  afterEach(() => {
    if (previousMcpUrl === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = previousMcpUrl;
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

  it("defaults MCP url to /mcp and derives API base by stripping it", () => {
    delete process.env.NEXT_PUBLIC_MCP_URL;
    expect(getMcpUrl()).toBe("http://localhost:8787/mcp");
    expect(getApiBaseUrl()).toBe("http://localhost:8787");
  });

  it("strips a trailing /mcp/ or /mcp/online/ suffix from a custom MCP url", () => {
    process.env.NEXT_PUBLIC_MCP_URL = "https://api.example.com/mcp/";
    expect(getApiBaseUrl()).toBe("https://api.example.com");
    process.env.NEXT_PUBLIC_MCP_URL = "https://api.example.com/mcp/online/";
    expect(getApiBaseUrl()).toBe("https://api.example.com");
  });
});
