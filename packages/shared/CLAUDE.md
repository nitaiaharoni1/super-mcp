<!-- Keep this file and docs/ updated when this subproject's conventions change -->

# @super-mcp/shared

Pure functions and types with no I/O, consumed by every other package. Part of the super-mcp monorepo. Built with TypeScript (ESM/NodeNext, `tsc` → `dist/`).

## Commands

```bash
pnpm build        # tsc -p tsconfig.json
pnpm dev          # tsc --watch
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (prefer `pnpm test` from the repo root)
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

- No I/O here, ever: no HTTP, no filesystem, no Postgres. A helper that needs any of those belongs in `@super-mcp/db` or the calling service.
- This is the dedup floor of the monorepo. Before adding a helper anywhere else, check the canonical-module table in `docs/folder-conventions.md` (`mapPool`, `scrubString`, `lookupChainNames`, `resolveEmbedModel`, `utils/units`, `utils/promo`, `GeoPoint`).
- Every `SUPER_MCP_*` environment variable is resolved in `src/utils/config.ts` — read env there, not at the call site.
- `./test-utils` is exported as raw TypeScript (`"./test-utils": { "import": "./test-utils/index.ts" }`), unlike `.` and `./analytics` which resolve through `dist/`. It is consumed only by test files.
- Consumers import the built output, so a change here is invisible to `services/*` until this package is rebuilt.
