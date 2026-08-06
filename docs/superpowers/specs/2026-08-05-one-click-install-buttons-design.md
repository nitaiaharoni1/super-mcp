# One-click install buttons for AI assistants

Date: 2026-08-05
Surface: `apps/web` (marketing site), connect section

## Problem

The connect section tells a shopper to "leave an email, paste the block we send you".
Between wanting the product and using it sit an email round-trip and a settings screen
the shopper has never opened. Most assistants now accept an install deeplink or a single
CLI command, so most of that gap is avoidable.

The page currently shows a decorative badge row (`AssistantRow`) naming Claude, ChatGPT,
Gemini and Cursor. It says which assistants work; it does nothing.

## What ships

A grid of per-assistant install cards, full width inside the connect section, between
the steps/screenshot grid and the developer disclosure. Each card carries one primary
action that installs or copies, plus one small link to that assistant's own docs.

| Target | Mechanism | Clicks |
|--------|-----------|--------|
| Cursor | `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 JSON>` | 1 |
| VS Code | `https://insiders.vscode.dev/redirect/mcp/install?name=…&config=<urlencoded JSON>` | 1 |
| Claude Code | copy `claude mcp add --transport http super-mcp <url>` | copy + paste |
| Claude (desktop / web) | copy URL, open Settings → Connectors | copy + 2 fields |
| ChatGPT | copy URL, open developer-mode connector settings | copy + 2 fields |
| Gemini CLI | copy `gemini mcp add --transport http super-mcp <url>` | copy + paste |

Deeplink formats are the documented ones: Cursor takes base64 of the bare server object,
VS Code takes `name` as a query parameter and URL-encoded JSON of `{type: "http", url}` as
`config`.

VS Code is reached over its https redirect rather than the equivalent `vscode:mcp/install`
scheme. A custom scheme a browser does not recognise is dropped with no error, and the
scheme also shows in the status bar as something a shopper should not click. The host is
literally `insiders.vscode.dev` and still opens stable VS Code; `&quality=insiders` is what
selects Insiders, and we never send it.

Two cards were dropped on 2026-08-06, leaving the six in the table:

- LM Studio (`lmstudio://add_mcp`, base64 config nested under the server name), too niche
  for this audience. The API still recognises the client string in analytics.
- The "any other tool" catch-all, which copied an English sentence for an agent to act on.
  It was the only markless card, so `InstallTarget.mark` is now required and the card
  drops its Sparkle fallback. The paragraph under the grid still says other tools work.

## Auth: one switch, keyless by default

A concurrent change adds `SUPER_MCP_ALLOW_ANONYMOUS=1` to the API (migration 035, a
seeded permanently-revoked `anonymous` row that keyless traffic meters against). Keyless
is where the product is going, so the site assumes it: `mcpRequiresApiKey()` reads
`NEXT_PUBLIC_MCP_REQUIRES_KEY` and defaults to **false**.

Every install artefact derives from that one boolean, including the existing `mcp.json`
block and `buildMcpServerConfig`. When it is true, each config regains
`headers: {Authorization: "Bearer <YOUR_API_KEY>"}` and each command regains
`--header "Authorization: Bearer <YOUR_API_KEY>"`; the Claude and ChatGPT cards gain a
line telling the reader to paste the key into the connector dialog's request-headers
field (`authorization` is on Claude's allowlist).

Verified on 2026-08-05: production answers an unauthenticated `tools/list` with HTTP
200 and the full tool list, so the keyless default matches what is deployed. If that
ever regresses, `NEXT_PUBLIC_MCP_REQUIRES_KEY=1` in App Hosting is the one-variable
way back to the key-bearing variant, with no code change.

ChatGPT is only reachable at all because of this default. Its custom connectors accept
OAuth or no auth, never a fixed header, so a key-bearing ChatGPT card would be a dead
end. Keyless makes the card honest.

The API key is never a user input on the page and never appears in a URL. Where a key is
needed the artefact carries `API_KEY_PLACEHOLDER`, exactly as the `mcp.json` block does
today.

## Files

- `src/lib/mcpInstall.ts` (new). Pure, no React: `mcpRequiresApiKey()`,
  `buildInstallTargets(url)` returning `{id, name, kind, href?, snippet?, docsHref, note?}`.
- `src/components/shared/assistantMarks.tsx` (new). The brand SVG paths, moved out of
  `AssistantRow` now that two components need them, plus a VS Code mark.
- `src/components/marketing/InstallButtons.tsx` (new). Client component, the card grid.
- `src/components/shared/AssistantRow.tsx`. Imports the marks instead of holding them.
- `src/components/marketing/Connect.tsx`. Renders `InstallButtons`.
- `src/lib/mcp.ts`. `buildMcpServerConfig` becomes key-aware.
- `src/content/he.ts`. New `connect.install` block; step 2 points at the buttons.
- `packages/shared/src/analytics/events.ts`. One event, `mcp_install_clicked`, with
  `{target, kind}` properties. Not one event per assistant.

## Design

Same sticker language as the rest of the page: `border-[3px] border-ink`, `shadow-sticker`,
paper-raised fill, small per-card tilts. Three columns at `lg`, two at `sm`, one on mobile.
RTL body text with `dir="ltr"` on assistant names, commands and URLs, matching how the
developer disclosure already handles tool names.

## Tests

`tests/lib/mcpInstall.test.ts`:

- each deeplink decodes back to the expected config object (base64 for Cursor,
  `decodeURIComponent` for VS Code);
- keyless mode emits no `Authorization` anywhere, in any target;
- key mode emits the placeholder and only the placeholder: no artefact matches a
  real-key shape;
- CLI snippets name the `super-mcp` server and the configured URL.

`tests/content/heOnlineSurface.test.ts` gains a check that every install target has copy.
