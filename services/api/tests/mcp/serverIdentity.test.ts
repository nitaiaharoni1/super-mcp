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

const TOOLS_LIST = { jsonrpc: "2.0", method: "tools/list", id: 2 } as const;

/** The transport answers as SSE, so the JSON-RPC envelope arrives on a `data:` line. */
function parseSseResult(body: string): Record<string, unknown> {
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  const payload = JSON.parse(line ? line.slice("data:".length) : body);
  return payload.result ?? {};
}

async function callMcp(payload: unknown): Promise<Record<string, unknown>> {
  const app = await buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { accept: "application/json, text/event-stream" },
      payload,
    });
    expect(response.statusCode).toBe(200);
    return parseSseResult(response.body);
  } finally {
    await app.close();
  }
}

async function initializeServerInfo(): Promise<Record<string, unknown>> {
  const result = await callMcp(INITIALIZE);
  return (result.serverInfo as Record<string, unknown>) ?? {};
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

/*
 * The connector submission states that every tool is read-only, and reviewers weigh
 * destructive capability. That claim has to be true of the advertised surface, not of
 * our recollection of it, so assert it over the whole tool list rather than a sample.
 */
describe("tools/list declares the surface read-only", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    process.env.SUPER_MCP_ALLOW_ANONYMOUS = "1";
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it("annotates every tool as read-only and open-world", async () => {
    const tools = (await callMcp(TOOLS_LIST)).tools as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.annotations, `${tool.name} has no annotations`).toBeDefined();
      expect(tool.annotations?.readOnlyHint, `${tool.name} is not read-only`).toBe(true);
      expect(tool.annotations?.openWorldHint, `${tool.name} is not open-world`).toBe(true);
    }
  });

  it("claims neither destructive nor idempotent, which read-only leaves undefined", async () => {
    const tools = (await callMcp(TOOLS_LIST)).tools as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];

    for (const tool of tools) {
      expect(tool.annotations).not.toHaveProperty("destructiveHint");
      expect(tool.annotations).not.toHaveProperty("idempotentHint");
    }
  });
});
