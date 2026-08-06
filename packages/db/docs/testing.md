# Testing

## Test Runner

Vitest 3 via `pnpm test` (`vitest run --passWithNoTests`). Prefer `pnpm test` from the repo root, which builds every package first.

## Running Tests

```bash
pnpm test                                          # Run all tests in this package
pnpm exec vitest run tests/priceHistory.test.ts    # Run a single test file
pnpm exec vitest                                   # Watch mode
```

## Test Structure

- `tests/` — mirrors `src/`, with `queries/` and `scripts/` subdirectories. `vitest.config.ts` only includes `tests/**/*.test.ts`, so colocated `src/**/*.test.ts` files are silently ignored.
- `tests/fixtures/` — JSON goldens (`herzliya-bbq-golden.json`, `semantic-benchmark.json`) used as regression baselines for resolution and semantic search.
- `test/helpers/` — per-package helpers, separate from the `tests/` tree.

## Writing Tests

- Almost every test mocks the query layer with `vi.mock` and asserts on the SQL and parameters produced, rather than hitting Postgres. The exception is `tests/queries/semantic/semanticIndex.test.ts`, which gates on `test/helpers/dbAvailability.ts` and self-skips when `DATABASE_URL` is unset.
- `--passWithNoTests` is on, so a misplaced or misnamed file makes the suite pass with nothing running. Check the reported file count when adding tests.
- Imports carry the `.js` extension even for `.ts` sources (NodeNext ESM resolution).
- When a golden fixture changes, review the diff rather than regenerating it blindly — these fixtures are the regression signal for basket accuracy.

## Workflow

- Write or update tests alongside the code they verify, not as a separate step after.
- Bug fixes: add a failing test that reproduces the bug before writing the fix.
- After implementation, run the full test suite to verify nothing else broke.

## Coverage

Not configured. Vitest's v8 coverage is not installed — add `@vitest/coverage-v8` as a dev dependency and run `vitest run --coverage` to enable it.
