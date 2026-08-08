# Listing SuperMCP where people already are

Three places a client can discover this server without anyone pasting a URL. They are
independent; do them in this order, because the first is self-serve and the other two
are review queues.

## 1. Official MCP Registry (self-serve, no review)

[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/) is the
upstream metadata index that aggregators and client galleries pull from. Publishing is
free and takes minutes.

```bash
brew install mcp-publisher

SUPER_MCP_PUBLIC_MCP_URL=https://<prod-host>/mcp \
SUPER_MCP_PUBLIC_SITE_URL=https://<marketing-site> \
scripts/publish-registry.sh
```

The script probes the URL first, renders [`server.template.json`](../server.template.json)
into a gitignored `server.json`, runs GitHub device-flow login, and publishes.

Things worth knowing before the first run:

- **The namespace is tied to the GitHub account.** The template names
  `io.github.nitaiaharoni1/super-mcp`, so `mcp-publisher login github` must authenticate
  as `nitaiaharoni1`. A custom-domain name like `co.supermcp/super-mcp` is possible via
  [DNS authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx)
  (a TXT record) if the GitHub-shaped name ever looks wrong on a shopper-facing listing.
- **No npm package is involved.** The entry is `remotes`-only, so there is no package
  ownership marker to add and no artifact to publish. That whole step in the registry
  quickstart does not apply here.
- **The remote must stay up at that exact URL.** A listed server that fails to connect
  is worse than an unlisted one: clients show it, users try it, it breaks. Re-run the
  script with a bumped `version` whenever the production URL changes.
- **The registry is in preview.** Breaking changes and data resets are possible, so
  treat a successful publish as something to re-check, not set and forget.
- **Auth state matters.** If the API is running with `SUPER_MCP_ALLOW_ANONYMOUS=1` the
  listing works as-is. If a key is required, add a `headers` entry to the `remotes`
  block in the template (`name: "Authorization"`, `isRequired: true`, `isSecret: true`)
  so clients prompt for it instead of connecting and failing.

## 2. Anthropic Connectors Directory (review queue)

The high-value one. Listed, SuperMCP stops being a URL a shopper pastes into a settings
dialog and becomes a toggle inside Claude. Submit at
[claude.com/docs/connectors/building/submission](https://claude.com/docs/connectors/building/submission);
the portal is always open and status is tracked in a submissions dashboard.

**Blocked on plan, not on readiness. Verified 2026-08-08.** Submitting a *remote* MCP server
happens inside Claude.ai organization admin settings, and those require a **Team or
Enterprise** plan with Owner access. On an individual plan (Free/Pro/Max) the portal answers
"You don't have access to organization settings" and there is no form at all. The operator
has decided not to upgrade, so this queue is parked, not in progress.

Nothing about the connector is the blocker: the requirements are met (see below). Do not
spend time re-checking readiness. The only thing that unblocks this is a Team org.

**Everything the form asks for is assembled in
[docs/connector-submission.md](./connector-submission.md)**: identity fields, the English
translation of the privacy policy, and reviewer test instructions verified against
production. Fill the form from that file the day a Team org exists.

Not being in the directory does not stop anyone using SuperMCP. Claude users on paid
individual plans can still add it by URL as a custom connector, and the MCP Registry listing
below is the free discovery route that aggregators pull from.

Satisfied as of 2026-08-08: Streamable HTTP transport, publicly reachable over HTTPS,
hosted privacy policy at `/privacy`, support contact, branding assets, keyless access so a
reviewer needs no test account, and `readOnlyHint` on every tool with a test that keeps it
honest.

Retention, if a reviewer asks how long anything is kept: `usage_event` and the cached
search phrases in `semantic_query_embedding` are both swept at 90 days by the nightly
ingest job, and `/privacy` states that window. `access_requests` is deliberately never
swept, because those rows are people who asked for access and the page says they are kept
until deletion is requested.

Escalations go to `mcp-review@anthropic.com`.

## 3. ChatGPT app directory (review queue)

[developers.openai.com/apps-sdk/app-submission-guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines).
Same shape as Anthropic's: production `/mcp` URL, domain verification, reviewer
credentials, five positive and three negative test cases. Two caveats: the MCP origin
cannot change between versions, and reporting through mid-2026 suggests full publishing
still skews toward larger companies. Queue it after Anthropic rather than instead of.
