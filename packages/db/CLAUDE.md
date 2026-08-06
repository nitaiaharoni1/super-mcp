<!-- Keep this file and docs/ updated when this subproject's conventions change -->

# @super-mcp/db

Postgres access layer and the home of most operational CLI scripts. Part of the super-mcp monorepo. Built with TypeScript, `pg`, and pgvector.

## Commands

```bash
pnpm build            # tsc -p tsconfig.json
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run --passWithNoTests
pnpm migrate          # apply src/migrations/*.sql in order
pnpm seed             # seed reference data and write a standard key to .local/api-key.txt
pnpm semantic-index   # embed products into the pgvector index
pnpm geocode-stores   # backfill store lat/lng via Nominatim
pnpm check-integrity  # data integrity report
```

Scripts that depend on `@super-mcp/shared` are safer to launch from the repo root
(`pnpm db:migrate`, `pnpm db:embed-products`, …) — those wrappers build `shared` first.

## Documentation

Read the doc that matches the change — not all of them. Root `.claude/docs/coding-guidelines.md`
applies to code in every package.

| Changing | Read first |
|---|---|
| Tests | `docs/testing.md` |
| Module structure or data flow | `docs/architecture.md` |
| Where a new module belongs | root `docs/folder-conventions.md` |

## Gotchas

- Persistence only: no HTTP, no FTP, no feed parsing. Those belong in `services/ingestion` or `services/api`.
- Migrations are append-only numbered SQL files in `src/migrations/` (currently through `035_*`). Never edit a landed migration; add the next number.
- After a bulk import or a large ingest run, Postgres needs an explicit `ANALYZE` — planner stats do not update on their own and query times regress badly without it.
- `src/scripts/*` are `tsx` entry points that read the source tree directly, while library consumers import `dist/`. A script can therefore run against code that `services/*` cannot yet see.
- Embedding scripts pull a local transformers.js model on first run, so the initial `semantic-index` is slow and needs network.
