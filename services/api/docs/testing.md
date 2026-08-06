# Testing

## Test Runner

Vitest 3 via `pnpm test` (`vitest run --passWithNoTests`). Prefer `pnpm test` from the repo root, which builds every package first. This is the largest suite in the monorepo (~90 files, ~770 tests, ~70s).

## Running Tests

```bash
pnpm test                                     # Unit suite (no database needed)
pnpm exec vitest run tests/auth.test.ts       # Run a single test file
pnpm exec vitest                              # Watch mode
pnpm test:live                                # tests/integration — needs a populated DATABASE_URL
pnpm test:perf                                # tests/performance — needs a populated DATABASE_URL
pnpm accuracy                                 # Basket accuracy harness (separate from vitest)
```

## Test Structure

- `tests/` — mirrors `src/`: `routes/`, `services/`, `lib/`, `mcp/`, `analytics/`, plus top-level files for `auth`, `admin`, `apiKeys`, and access control.
- `tests/integration/` and `tests/performance/` — live suites, run only by `test:live` / `test:perf`.
- `tests/setupEnv.ts` — loaded for every test by `vitest.config.ts`; sets `BASKET_CONTINUATION_SECRET` so the app can boot.
- `tests/fixtures/` and `test/helpers/` — basket fixtures and shared builders (`searchProductHit.ts`, `env.ts`).

## Writing Tests

- Mock `@super-mcp/db` with `vi.mock` and assert on behaviour; do not reach for a real Postgres in the default suite.
- The live suites use `describe.skipIf(!LIVE)` and pass silently when the database is absent, so a green `pnpm test` is not evidence the MCP path works. Run `pnpm test:live` against a seeded database when touching basket resolution, delivery, or search.
- `--passWithNoTests` is on, so a misplaced file makes the suite pass with nothing running. Check the reported file count when adding tests.
- Imports carry the `.js` extension even for `.ts` sources (NodeNext ESM resolution).

## Workflow

- Write or update tests alongside the code they verify, not as a separate step after.
- Bug fixes: add a failing test that reproduces the bug before writing the fix.
- After implementation, run the full test suite to verify nothing else broke.

## Coverage

Not configured. Vitest's v8 coverage is not installed — add `@vitest/coverage-v8` as a dev dependency and run `vitest run --coverage` to enable it.
