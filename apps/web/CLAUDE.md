<!-- Keep this file and docs/ updated when this subproject's conventions change -->

# @super-mcp/web

Hebrew RTL marketing landing with an inline access-request form. Part of the super-mcp monorepo. Built with Next.js 15, React 19, and Tailwind 4.

## Commands

```bash
pnpm dev            # next dev on :3000 (or `pnpm dev:web` from the repo root)
pnpm build          # next build
pnpm build:check    # next build into .next-check, so it never clobbers a running dev server
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run --passWithNoTests
```

## Documentation

Read the doc that matches the change — not all of them. Root `.claude/docs/coding-guidelines.md`
applies to code in every package.

| Changing | Read first |
|---|---|
| UI, CSS, visual changes | `docs/styling.md` |
| Tests | `docs/testing.md` |
| Module structure or data flow | `docs/architecture.md` |

## Gotchas

- `typescript` is pinned to the npm alias `npm:@typescript/typescript6@^6.0.2` while the repo root pins `typescript@^7.0.2`. `README.md` records this as a deliberate Next 15 compatibility deviation — do not bump it without verifying Next 15 support.
- All Hebrew copy and every published figure live in `src/content/he.ts`, not in components. No number ships without a measurement date next to it.
- `NEXT_PUBLIC_*` values are baked in at build time, so changing `NEXT_PUBLIC_MCP_URL` requires a rebuild, not a restart. The API base URL for the access form is derived from it by stripping `/mcp` (or the legacy `/mcp/online`).
- The access form POSTs cross-origin to the API, so `CORS_ORIGINS` must list this app's origin on the API side or the form fails silently in the browser.
- `firebase-hosting/` is generated from `public/` at deploy time and is gitignored except for its `.gitkeep`.
