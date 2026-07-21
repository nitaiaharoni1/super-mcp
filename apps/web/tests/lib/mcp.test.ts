import { describe, expect, it } from "vitest";
import {
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  buildMcpServerConfig,
} from "@/lib/mcp";

describe("mcp helpers", () => {
  const url = "https://api.example.com/mcp";

  it("builds url-only server config for streamable HTTP", () => {
    expect(buildMcpServerConfig(url)).toEqual({ url });
  });

  it("builds mcp.json snippet with mcpServers wrapper", () => {
    const snippet = buildMcpJsonSnippet(url);
    expect(JSON.parse(snippet)).toEqual({
      mcpServers: {
        "super-mcp": { url },
      },
    });
  });

  it("builds Cursor install deeplink with base64 config", () => {
    const link = buildCursorInstallLink("super-mcp", url);
    const expectedConfig = Buffer.from(JSON.stringify({ url }), "utf8").toString("base64");
    expect(link).toBe(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=super-mcp&config=${expectedConfig}`,
    );
  });
});
