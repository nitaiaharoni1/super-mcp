export const MCP_SERVER_NAME = "super-mcp";

export function getMcpUrl(): string {
  return process.env.NEXT_PUBLIC_MCP_URL?.trim() || "http://localhost:8787/mcp";
}

export function buildMcpServerConfig(url: string): { url: string } {
  return { url };
}

export function buildMcpJsonSnippet(url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: buildMcpServerConfig(url),
      },
    },
    null,
    2,
  );
}

function toBase64Json(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64");
  }
  // Browser path for client ConnectPanel
  return btoa(unescape(encodeURIComponent(json)));
}

/** Cursor MCP install deeplink: https://cursor.com/docs/mcp/install-links */
export function buildCursorInstallLink(name: string, url: string): string {
  const config = toBase64Json(buildMcpServerConfig(url));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}
