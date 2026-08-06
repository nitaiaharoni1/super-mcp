<!-- Keep this file, .claude/docs/, and subproject CLAUDE.md files updated when project structure changes -->

# super-mcp

Canonical supermarket data API + MCP for AI agents (Israel first). Monorepo with 5 packages, managed by pnpm workspaces.

## Architecture

| Subproject | Purpose | Stack |
|---------|---------|-------|
| `packages/shared` | Pure types, units, promo math, intent/embeddings, env config — no I/O | TypeScript library |
| `packages/db` | Postgres access only: pool, migrations, queries, semantic index, CLI scripts | pg, pgvector, transformers.js |
| `services/api` | Fastify REST (`/v1/**`) + remote MCP (`/mcp`), auth, metering, analytics | Fastify 5, MCP SDK, Zod |
| `services/ingestion` | Price-transparency feed adapters plus a separate online/scraped flow | basic-ftp, fast-xml-parser |
| `apps/web` | Hebrew RTL marketing landing with an inline access-request form | Next.js 15, React 19, Tailwind 4 |

Each subproject has its own CLAUDE.md, loaded automatically when working in that directory.

## Commands

```bash
pnpm build          # tsc across every package
pnpm test           # build, then vitest in every package
pnpm typecheck      # build, then tsc --noEmit everywhere (`pnpm lint` is an alias)
pnpm dev            # free the dev port, then run the API in watch mode on :8787
pnpm dev:web        # Next dev server on :3000
pnpm db:migrate     # apply packages/db/src/migrations/*.sql
pnpm ingest         # full national ingest (`ingest:fixture`, `ingest:online` are the variants)
pnpm create-key     # mint an API key (add `-- --role=master` for a master key)
```

## Documentation

Read the doc that matches the change — not all of them.

| Changing | Read first |
|---|---|
| Code | `.claude/docs/coding-guidelines.md` |
| Where a new module belongs | `docs/folder-conventions.md` |
| Deploy, hosting, or cloud config | `docs/DEPLOY.md` |

## Gotchas

- Workspace packages resolve through their compiled `dist/`, so `vitest` or `pnpm --filter <pkg> test` run directly tests stale code. Every root script prefixes a build for this reason (`"test": "pnpm build && pnpm -r run test"`); run tests from the root.
- `.github/workflows/ci.yml` is `on: workflow_dispatch` only (deliberate, to save Actions minutes), so nothing runs on push or PR. Start a run with `gh workflow run ci.yml`.
- `pnpm lint` is an alias for `pnpm typecheck`. There is no ESLint or Prettier config anywhere in the tree, so the `// eslint-disable-next-line` comments in `apps/web/src/components/shared/assistantMarks.tsx` suppress nothing.
- `pnpm test` can pass green with the MCP path untested: `services/api/tests/integration/**` and `tests/performance/**` use `describe.skipIf(!LIVE)` and silently skip unless `DATABASE_URL` points at a populated Postgres (plus `BASKET_CONTINUATION_SECRET` and `GEOCODING_CACHE_SECRET`).
- `firebase.json`, `.firebaserc`, `/server.json`, and `apps/web/firebase-hosting/*` are gitignored or generated (`server.json` comes from `server.template.json` via `scripts/publish-registry.sh`). A fresh clone cannot redeploy Hosting until they are recreated from `docs/DEPLOY.md`.
