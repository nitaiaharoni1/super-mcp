# Security Policy

## Supported versions

Security fixes are applied on the default branch (`main` / `master`). There are no long-lived release branches yet.

## Reporting a vulnerability

**Do not** open a public GitHub issue for security reports.

Prefer [GitHub Security Advisories](https://github.com/nitaiaharoni1/super-mcp/security/advisories/new) for this repository. Include:

- Affected component (API, MCP, ingestion, docs)
- Reproduction steps or proof-of-concept
- Impact assessment (auth bypass, SSRF, secret leak, etc.)

We will acknowledge reports as soon as practical and coordinate disclosure after a fix is available.

## Hosted vs self-host

- The **public repository** contains no production cloud credentials. Self-hosting means you run your own database, secrets, and deploy pipeline.
- A separately **hosted** MCP/API (when offered) uses operator-managed secrets (API keys, `BASKET_CONTINUATION_SECRET`, `GEOCODING_CACHE_SECRET`, database URLs). Those secrets are never committed here.
- Never enable `SUPER_MCP_ALLOW_MCP_QUERY_API_KEY` on a public host (keys in URLs leak via logs and Referer).
- Never reuse README/test continuation secrets in production.

## Operational notes

- Master API keys are break-glass: create them only via `pnpm create-key -- --role=master`. HTTP admin cannot mint masters.
- Issue **standard** keys to external users. Keep masters offline and rotated.
- Set `CORS_ORIGINS` to an explicit allowlist when a browser origin must call the API; leave it unset to disable browser CORS.
- Set `SUPER_MCP_READY_REQUIRE_AUTH=1` on public hosts if you do not want unauthenticated catalog inventory on `GET /ready`.
