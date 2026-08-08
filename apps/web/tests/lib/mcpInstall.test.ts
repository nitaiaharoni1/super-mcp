import { afterEach, describe, expect, it } from "vitest";
import { API_KEY_PLACEHOLDER } from "@/lib/mcp";
import { buildInstallTargets, mcpRequiresApiKey } from "@/lib/mcpInstall";

const url = "https://api.example.com/mcp";

function decodeCursorConfig(href: string): unknown {
  const config = new URL(href).searchParams.get("config");
  expect(config).toBeTruthy();
  return JSON.parse(Buffer.from(config as string, "base64").toString("utf8"));
}

function decodeVsCodeConfig(href: string): unknown {
  const config = new URL(href).searchParams.get("config");
  expect(config).toBeTruthy();
  return JSON.parse(config as string);
}

describe("mcpRequiresApiKey", () => {
  const previous = process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY;
    else process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY = previous;
  });

  it("defaults to keyless, matching SUPER_MCP_ALLOW_ANONYMOUS on the API", () => {
    delete process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY;
    expect(mcpRequiresApiKey()).toBe(false);
  });

  it("only 1 turns the key back on, so a stray value cannot half-enable it", () => {
    process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY = "1";
    expect(mcpRequiresApiKey()).toBe(true);
    process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY = "true";
    expect(mcpRequiresApiKey()).toBe(false);
    process.env.NEXT_PUBLIC_MCP_REQUIRES_KEY = "0";
    expect(mcpRequiresApiKey()).toBe(false);
  });
});

describe("install targets, keyless", () => {
  const targets = buildInstallTargets(url, false);
  const byId = new Map(targets.map((t) => [t.id, t]));

  it("covers every advertised assistant exactly once, and nothing else", () => {
    expect(targets.map((t) => t.id)).toEqual([
      "cursor",
      "vscode",
      "claude-code",
      "claude",
      "chatgpt",
      "gemini-cli",
    ]);
  });

  it("gives every card a brand mark: the grid has no markless card to fall back for", () => {
    for (const target of targets) expect(target.mark).toBeTruthy();
  });

  it("builds a Cursor deeplink whose base64 config decodes to the bare server", () => {
    const href = byId.get("cursor")?.href as string;
    expect(href.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
    expect(new URL(href).searchParams.get("name")).toBe("super-mcp");
    expect(decodeCursorConfig(href)).toEqual({ url });
  });

  /*
   * The https redirect, not the `vscode:` scheme: a browser that does not know the
   * scheme drops the click without saying so. Naming the server moves out of the
   * config and into its own query parameter, and stable VS Code is the default,
   * which is why nothing here carries `quality=insiders`.
   */
  it("builds a VS Code install link on the https redirect, server named by query", () => {
    const href = byId.get("vscode")?.href as string;
    expect(href.startsWith("https://insiders.vscode.dev/redirect/mcp/install?")).toBe(true);
    expect(new URL(href).searchParams.get("name")).toBe("super-mcp");
    expect(new URL(href).searchParams.get("quality")).toBeNull();
    expect(decodeVsCodeConfig(href)).toEqual({ type: "http", url });
  });

  it("builds CLI commands that name the server and the configured url", () => {
    expect(byId.get("claude-code")?.snippet).toBe(
      `claude mcp add --transport http super-mcp ${url}`,
    );
    expect(byId.get("gemini-cli")?.snippet).toBe(
      `gemini mcp add --transport http super-mcp ${url}`,
    );
  });

  it("hands the paste-the-url assistants the url and their settings screen", () => {
    for (const id of ["claude", "chatgpt"]) {
      const target = byId.get(id);
      expect(target?.kind).toBe("url");
      expect(target?.snippet).toBe(url);
      expect(target?.settingsHref).toMatch(/^https:\/\//);
    }
  });

  /*
   * The plugins pane grows its add button only once Developer mode is on, so the
   * link has to land on the toggle. It previously pointed at #settings/Connectors,
   * a section ChatGPT has since renamed, which opened settings on nothing.
   */
  it("sends ChatGPT to the developer-mode toggle, not to the pane that needs it", () => {
    const href = byId.get("chatgpt")?.settingsHref as string;
    expect(href).toContain("chatgpt.com");
    expect(href).toContain("developer-mode");
    expect(href).not.toContain("Connectors");
  });

  it("mentions no credential anywhere: a keyless install that carried one would 401", () => {
    const everything = [
      JSON.stringify(targets),
      JSON.stringify(decodeVsCodeConfig(byId.get("vscode")?.href as string)),
      JSON.stringify(decodeCursorConfig(byId.get("cursor")?.href as string)),
    ].join(" ");
    expect(everything).not.toMatch(/Authorization|Bearer|api_key/i);
  });
});

describe("install targets, key required", () => {
  const targets = buildInstallTargets(url, true);
  const byId = new Map(targets.map((t) => [t.id, t]));
  const expectedHeader = { Authorization: `Bearer ${API_KEY_PLACEHOLDER}` };

  it("puts the Authorization header inside both deeplink configs", () => {
    expect(decodeCursorConfig(byId.get("cursor")?.href as string)).toEqual({
      url,
      headers: expectedHeader,
    });
    expect(decodeVsCodeConfig(byId.get("vscode")?.href as string)).toEqual({
      type: "http",
      url,
      headers: expectedHeader,
    });
  });

  it("adds --header to both CLI commands", () => {
    for (const id of ["claude-code", "gemini-cli"]) {
      expect(byId.get(id)?.snippet).toContain(
        `--header "Authorization: Bearer ${API_KEY_PLACEHOLDER}"`,
      );
    }
  });

  it("carries the placeholder and never anything shaped like a real key", () => {
    const everything =
      JSON.stringify(targets) +
      JSON.stringify(decodeCursorConfig(byId.get("cursor")?.href as string));
    expect(everything).toContain(API_KEY_PLACEHOLDER);
    expect(everything).not.toMatch(/sk-|Bearer [A-Za-z0-9_-]{16,}/);
  });

  it("keeps the url-paste assistants free of a key: a URL is not a place for one", () => {
    for (const id of ["claude", "chatgpt"]) {
      expect(byId.get(id)?.snippet).toBe(url);
    }
  });
});
