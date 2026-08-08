import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
  withTransaction: vi.fn(),
}));

import { buildApp } from "../../src/app.js";

const INITIALIZE = {
  jsonrpc: "2.0",
  method: "initialize",
  id: 1,
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "identity-test", version: "0" },
  },
} as const;

/** The transport answers as SSE, so the JSON-RPC envelope arrives on a `data:` line. */
function parseSseResult(body: string): { serverInfo?: Record<string, unknown> } {
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  const payload = JSON.parse(line ? line.slice("data:".length) : body);
  return payload.result ?? {};
}

async function initializeServerInfo(): Promise<Record<string, unknown>> {
  const app = await buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { accept: "application/json, text/event-stream" },
      payload: INITIALIZE,
    });
    expect(response.statusCode).toBe(200);
    return parseSseResult(response.body).serverInfo ?? {};
  } finally {
    await app.close();
  }
}

describe("initialize advertises the SuperMCP brand", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    delete process.env.SUPER_MCP_PUBLIC_SITE_URL;
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it("carries the logo, title and website on the default origin", async () => {
    const serverInfo = await initializeServerInfo();

    expect(serverInfo.name).toBe("super-mcp");
    expect(serverInfo.title).toBe("SuperMCP");
    expect(serverInfo.websiteUrl).toBe("https://supermcp.web.app");
    expect(serverInfo.icons).toEqual([
      {
        src: "https://supermcp.web.app/icon-192.png",
        mimeType: "image/png",
        sizes: ["192x192"],
      },
      {
        src: "https://supermcp.web.app/icon-512.png",
        mimeType: "image/png",
        sizes: ["512x512"],
      },
    ]);
  });

  it("follows SUPER_MCP_PUBLIC_SITE_URL and drops its trailing slash", async () => {
    process.env.SUPER_MCP_PUBLIC_SITE_URL = "https://staging.example.com/";

    const serverInfo = await initializeServerInfo();

    expect(serverInfo.websiteUrl).toBe("https://staging.example.com");
    expect((serverInfo.icons as { src: string }[]).map((icon) => icon.src)).toEqual([
      "https://staging.example.com/icon-192.png",
      "https://staging.example.com/icon-512.png",
    ]);
  });
});
