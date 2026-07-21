export const MCP_SERVER_NAME = "super-mcp";
export const API_KEY_PLACEHOLDER = "<YOUR_API_KEY>";

export function getMcpUrl(): string {
  return process.env.NEXT_PUBLIC_MCP_URL?.trim() || "http://localhost:8787/mcp";
}

export function getAccessEmail(): string | null {
  const email = process.env.NEXT_PUBLIC_ACCESS_EMAIL?.trim() || "";
  return email.length > 0 ? email : null;
}

/** Authenticated Streamable HTTP MCP config. Never embeds a real key. */
export function buildMcpServerConfig(url: string): {
  url: string;
  headers: { Authorization: string };
} {
  return {
    url,
    headers: {
      Authorization: `Bearer ${API_KEY_PLACEHOLDER}`,
    },
  };
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

export function buildAccessMailto(email: string): string {
  const subject = "בקשת גישה ל-Super MCP";
  const body = [
    "שלום,",
    "",
    "אשמח לקבל גישת MCP/API ל-Super MCP.",
    "",
    "שם / פרויקט:",
    "שימוש מתוכנן (Cursor / Claude / אחר):",
    "הערות:",
  ].join("\n");

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
