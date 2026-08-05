export const MCP_SERVER_NAME = "super-mcp";
export const API_KEY_PLACEHOLDER = "<YOUR_API_KEY>";

export function getMcpUrl(): string {
  return process.env.NEXT_PUBLIC_MCP_URL?.trim() || "http://localhost:8787/mcp";
}

/**
 * Public origin of the marketing site, used as `metadataBase` so the OG image
 * resolves to an absolute URL (crawlers treat relative `og:image` inconsistently).
 *
 * Comes from the environment because docs/DEPLOY.md forbids real project IDs and
 * hosts in the public tree. Set `NEXT_PUBLIC_SITE_URL` in App Hosting; the
 * localhost fallback only ever applies in development, where nothing crawls it.
 */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
}

/** API origin for public endpoints, derived from the MCP URL (same host). */
export function getApiBaseUrl(): string {
  return getMcpUrl().replace(/\/mcp(\/online)?\/?$/, "");
}

/**
 * Streamable HTTP MCP config. Never embeds a real key.
 *
 * `requiresKey` comes from `mcpRequiresApiKey()` in ./mcpInstall so the whole page
 * (this block, every deeplink, every CLI command) says the same thing about auth.
 * It is a parameter rather than a direct read to keep this module pure.
 */
export function buildMcpServerConfig(
  url: string,
  requiresKey = true,
): {
  url: string;
  headers?: { Authorization: string };
} {
  if (!requiresKey) return { url };
  return {
    url,
    headers: {
      Authorization: `Bearer ${API_KEY_PLACEHOLDER}`,
    },
  };
}

export function buildMcpJsonSnippet(url: string, requiresKey = true): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: buildMcpServerConfig(url, requiresKey),
      },
    },
    null,
    2,
  );
}

