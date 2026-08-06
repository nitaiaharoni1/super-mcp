<!-- Keep this file and docs/ updated when this subproject's conventions change -->

# @super-mcp/api

Fastify REST surface (`/v1/**`) and the remote MCP server (`/mcp`), plus auth, metering, and analytics. Part of the super-mcp monorepo. Built with Fastify 5, `@modelcontextprotocol/sdk`, and Zod.

## Commands

```bash
pnpm dev              # tsx watch on :8787 (or `pnpm dev` from the repo root, which frees the port first)
pnpm build            # tsc -p tsconfig.json
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run --passWithNoTests
pnpm test:live        # tests/integration — needs a populated DATABASE_URL
pnpm test:perf        # tests/performance — needs a populated DATABASE_URL
pnpm accuracy         # basket accuracy harness CLI
pnpm canary:basket    # end-to-end basket canary against a live DB
pnpm create-key       # mint an API key (`-- --role=master` for a master key)
```

## Documentation

Read the doc that matches the change — not all of them. Root `.claude/docs/coding-guidelines.md`
applies to code in every package.

| Changing | Read first |
|---|---|
| Tests | `docs/testing.md` |
| Module structure or data flow | `docs/architecture.md` |
| Where a new module belongs | root `docs/folder-conventions.md` |

## Gotchas

- `pnpm test` uses `--passWithNoTests` and the integration/performance suites are `describe.skipIf(!LIVE)`, so a green run proves nothing about the live MCP path. Point `DATABASE_URL` at a seeded Postgres and run `pnpm test:live` when touching basket resolution or delivery.
- Never rank or compare stores on raw `total` — that flatters the store stocking the least. Use `comparableTotal` / `deliveredComparableTotal`, which impute median market price for unpriced lines.
- Ambiguity returns `needs_confirmation` rather than a guess: a wrong product is worse than an unresolved one. Resolution is deterministic-first (exact name, phrase, and class gates), with embeddings only where lexical recall is weak.
- Master keys are CLI-only. The HTTP admin route mints `standard` keys only, and no credential may move to a query string — Bearer auth only.
- `tests/setupEnv.ts` is loaded by `vitest.config.ts` for every test and supplies `BASKET_CONTINUATION_SECRET`, which the app refuses to boot without. A test needing any other secret must set it itself.
