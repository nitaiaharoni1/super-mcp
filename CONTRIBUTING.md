# Contributing

Thanks for helping improve Super MCP.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io) 9+
- Postgres 16+ with the [`pgvector`](https://github.com/pgvector/pgvector) extension (local install, Homebrew, or Docker)

Example Docker Postgres:

```bash
docker run --name super-mcp-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=super_mcp \
  -p 5432:5432 -d pgvector/pgvector:pg16
```

## Local setup

```bash
cp .env.example .env
# Edit DATABASE_URL, and set BASKET_CONTINUATION_SECRET to a random ≥32-byte string.
pnpm install
pnpm db:migrate
pnpm db:seed          # writes a standard key to .local/api-key.txt (gitignored)
pnpm test
pnpm dev              # API + MCP on http://localhost:8787
```

See [DATA.md](./DATA.md) for feed provenance and what is (not) redistributed in this repo.

## Reporting issues

Use the GitHub issue forms ([Bug](https://github.com/nitaiaharoni1/super-mcp/issues/new?template=bug.yml) / [Feature](https://github.com/nitaiaharoni1/super-mcp/issues/new?template=feature.yml)).

Security vulnerabilities → [SECURITY.md](./SECURITY.md) / private GitHub Security Advisories — not a public issue.

## Development norms

- Keep packages `"private": true` unless there is an intentional publish decision.
- Do not commit `.env`, `.local/`, `data/raw/`, credential JSON, or Firebase project files.
- Prefer Bearer auth; do not add new query-string credential paths.
- Master keys: CLI only (`pnpm create-key -- --role=master`). Admin HTTP mints **standard** keys only.
- Run `pnpm test` before opening a PR. CI also runs gitleaks and the semantic benchmark job.

## Pull requests

`main` is protected: changes land only via pull request. Required checks: `test`, `gitleaks`, `benchmark`. Approving reviews are not required (solo-maintainer friendly); CI must be green.

1. Fork or branch from `main` (do not push commits directly to `main`).
2. Keep PRs focused; mention any security or data-license impact.
3. Link related issues when applicable.
4. Wait for CI, then merge (squash is fine).

## Deploy / cloud access

This open-source tree must not contain production project IDs, service-account keys, or deploy credentials. See [docs/DEPLOY.md](./docs/DEPLOY.md) for the intended private-ops boundary (OIDC + GitHub Environments / private ops repo).
