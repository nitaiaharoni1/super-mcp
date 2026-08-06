import { API_KEY_PLACEHOLDER, MCP_SERVER_NAME, buildMcpServerConfig } from "@/lib/mcp";

/**
 * Per-assistant install artefacts: a deeplink, a CLI command, or a URL to paste.
 *
 * Pure on purpose. Everything here is a string derived from the MCP URL and one
 * boolean, so the deeplink formats can be decoded and asserted in tests rather
 * than eyeballed in a browser.
 *
 * Formats are the documented ones:
 *   Cursor  cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 JSON>
 *   VS Code https://insiders.vscode.dev/redirect/mcp/install?name=…&config=<urlencoded JSON>
 */

/** How the reader gets the server in front of their assistant. */
export type InstallKind = "deeplink" | "command" | "url";

export interface InstallTarget {
  id: string;
  /** Card heading. Always a brand name, so the UI can set dir="ltr" on it. */
  name: string;
  /** Key into ASSISTANT_MARKS. Several targets share one brand (Claude, Claude Code). */
  mark: "claude" | "chatgpt" | "gemini" | "cursor" | "vscode";
  kind: InstallKind;
  /** Deeplink to open. Only on kind === "deeplink". */
  href?: string;
  /** Text to copy. On "command" a shell line, on "url" the server URL. */
  snippet?: string;
  /** Where the reader pastes a "url" snippet. Only on kind === "url". */
  settingsHref?: string;
  /** That assistant's own MCP documentation. */
  docsHref: string;
}

/**
 * Whether the published config carries an Authorization header.
 *
 * Defaults to keyless: the API serves `/mcp` without a credential when
 * SUPER_MCP_ALLOW_ANONYMOUS=1, and that is the direction of travel. Set
 * NEXT_PUBLIC_MCP_REQUIRES_KEY=1 to go back to the key-bearing variant in one
 * variable, without touching this file.
 */
export function mcpRequiresApiKey(): boolean {
  return process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY?.trim() === "1";
}

/** UTF-8 safe base64 that works in the browser and in Node, where `btoa` is global since 16. */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `--header` argument for the CLIs, empty when the server takes no credential. */
function headerFlag(requiresKey: boolean): string {
  return requiresKey ? ` --header "Authorization: Bearer ${API_KEY_PLACEHOLDER}"` : "";
}

function cursorHref(url: string, requiresKey: boolean): string {
  const config = toBase64(JSON.stringify(buildMcpServerConfig(url, requiresKey)));
  return (
    "cursor://anysphere.cursor-deeplink/mcp/install" +
    `?name=${encodeURIComponent(MCP_SERVER_NAME)}&config=${encodeURIComponent(config)}`
  );
}

/**
 * The https redirect rather than the `vscode:mcp/install?<json>` scheme.
 *
 * Both reach the same handler, but a custom scheme is silently dropped by
 * browsers that do not know it, and a link whose hover text reads `vscode:` looks
 * like something a shopper should not click. The redirect is an ordinary https
 * link Microsoft owns, and it is what GitHub's own MCP server ships.
 *
 * The host is literally `insiders.vscode.dev` and it still opens stable VS Code;
 * `&quality=insiders` is what targets the Insiders build. Do not "fix" the name.
 *
 * Shape differs from the scheme form too: here the server is named by the `name`
 * query parameter, so `config` carries only the transport and the url.
 */
function vscodeHref(url: string, requiresKey: boolean): string {
  const config = { type: "http" as const, ...buildMcpServerConfig(url, requiresKey) };
  return (
    "https://insiders.vscode.dev/redirect/mcp/install" +
    `?name=${encodeURIComponent(MCP_SERVER_NAME)}&config=${encodeURIComponent(JSON.stringify(config))}`
  );
}

export function buildInstallTargets(
  url: string,
  requiresKey: boolean = mcpRequiresApiKey(),
): InstallTarget[] {
  const header = headerFlag(requiresKey);

  return [
    {
      id: "cursor",
      name: "Cursor",
      mark: "cursor",
      kind: "deeplink",
      href: cursorHref(url, requiresKey),
      docsHref: "https://cursor.com/docs/context/mcp",
    },
    {
      id: "vscode",
      name: "VS Code",
      mark: "vscode",
      kind: "deeplink",
      href: vscodeHref(url, requiresKey),
      docsHref: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      mark: "claude",
      kind: "command",
      snippet: `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}${header}`,
      docsHref: "https://code.claude.com/docs/en/mcp",
    },
    {
      id: "claude",
      name: "Claude",
      mark: "claude",
      kind: "url",
      snippet: url,
      settingsHref: "https://claude.ai/settings/connectors",
      docsHref: "https://support.claude.com/en/articles/11175166",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      mark: "chatgpt",
      kind: "url",
      snippet: url,
      settingsHref: "https://chatgpt.com/#settings/Connectors",
      docsHref: "https://help.openai.com/en/articles/12584461",
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      mark: "gemini",
      kind: "command",
      snippet: `gemini mcp add --transport http ${MCP_SERVER_NAME} ${url}${header}`,
      docsHref: "https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html",
    },
  ];
}
