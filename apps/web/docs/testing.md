# Testing

## Test Runner

Vitest 3 via `pnpm test` (`vitest run --passWithNoTests`). Prefer `pnpm test` from the repo root, which builds every package first.

## Running Tests

```bash
pnpm test                                          # Run all tests in this package
pnpm exec vitest run tests/lib/mcpInstall.test.ts  # Run a single test file
pnpm exec vitest                                   # Watch mode
```

## Test Structure

- `tests/` — mirrors `src/`: `lib/` for the install-link and MCP helpers, `content/` for copy invariants.
- `vitest.config.ts` sets `environment: "node"` and aliases `@` to `src/`, so tests import `@/lib/...` exactly as components do.

## Writing Tests

- There is no jsdom and no React Testing Library here — the suite covers pure logic and content invariants, not rendered components. Keep new tests on that side of the line unless the environment is changed deliberately.
- `tests/content/heOnlineSurface.test.ts` asserts the Hebrew copy in `src/content/he.ts` still describes the online-delivery surface and never promises physical-branch tools (`optimize_basket`, `list_stores`) or walking distances. Extend it when adding a claim or an install target.
- `NEXT_PUBLIC_*` values are read at module scope, so a test that changes one must save and restore `process.env` around itself.
- `--passWithNoTests` is on, so a misplaced file makes the suite pass with nothing running.

## Workflow

- Write or update tests alongside the code they verify, not as a separate step after.
- Bug fixes: add a failing test that reproduces the bug before writing the fix.
- After implementation, run the full test suite to verify nothing else broke.

## Coverage

Not configured. Vitest's v8 coverage is not installed — add `@vitest/coverage-v8` as a dev dependency and run `vitest run --coverage` to enable it.
