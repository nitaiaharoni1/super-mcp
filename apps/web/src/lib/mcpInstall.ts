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
 *   VS Code vscode:mcp/install?<urlencoded JSON>   (server named inline, not nested)
 */

/**
 * How the reader gets the server in front of their assistant.
 *
 * `prompt` is the catch-all: agentic clients edit their own MCP config when asked,
 * so one pasted sentence covers every tool we have no deeplink for, including ones
 * that do not exist yet. It is last in the list because it only works inside an
 * agent, not in a chat window like Claude on the web.
 */
export type InstallKind = "deeplink" | "command" | "url" | "prompt";

export interface InstallTarget {
  id: string;
  /** Card heading. A brand name where `mark` is set, otherwise Hebrew. */
  name: string;
  /**
   * Key into ASSISTANT_MARKS. Several targets share one brand (Claude, Claude Code).
   * Absent on the catch-all card, which is also how the UI knows the heading is
   * Hebrew and must not be forced to dir="ltr".
   */
  mark?: "claude" | "chatgpt" | "gemini" | "cursor" | "vscode" | "lmstudio";
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
 * LM Studio nests the server under its own name, where Cursor takes the bare
 * object. Same base64, different shape: getting this wrong installs nothing and
 * reports no error.
 */
function lmStudioHref(url: string, requiresKey: boolean): string {
  const config = toBase64(
    JSON.stringify({ [MCP_SERVER_NAME]: buildMcpServerConfig(url, requiresKey) }),
  );
  return (
    "lmstudio://add_mcp" +
    `?name=${encodeURIComponent(MCP_SERVER_NAME)}&config=${encodeURIComponent(config)}`
  );
}

/**
 * One sentence an agent can act on. English because it is addressed to the model,
 * not to the reader, and asking it to list the tools afterwards makes the agent
 * prove the connection instead of claiming it.
 */
function agentPrompt(url: string, requiresKey: boolean): string {
  const auth = requiresKey
    ? ` Use the header "Authorization: Bearer ${API_KEY_PLACEHOLDER}".`
    : "";
  return (
    `Add the remote MCP server "${MCP_SERVER_NAME}" at ${url} to my configuration, ` +
    `using Streamable HTTP transport.${auth} Then list its tools so I can see it connected.`
  );
}

function vscodeHref(url: string, requiresKey: boolean): string {
  const config = {
    name: MCP_SERVER_NAME,
    type: "http" as const,
    ...buildMcpServerConfig(url, requiresKey),
  };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
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
    {
      id: "lmstudio",
      name: "LM Studio",
      mark: "lmstudio",
      kind: "deeplink",
      href: lmStudioHref(url, requiresKey),
      docsHref: "https://lmstudio.ai/docs/app/plugins/mcp",
    },
    {
      id: "prompt",
      name: "כל כלי אחר",
      kind: "prompt",
      snippet: agentPrompt(url, requiresKey),
      docsHref: "https://modelcontextprotocol.io/docs/develop/connect-remote-servers",
    },
  ];
}
