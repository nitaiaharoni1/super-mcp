# Testing

## Test Runner

Vitest 3 via `pnpm test` (`vitest run`). Prefer `pnpm test` from the repo root, which builds every package first.

## Running Tests

```bash
pnpm test                              # Run all tests in this package
pnpm exec vitest run tests/utils/units.test.ts   # Run a single test file
pnpm exec vitest                       # Watch mode
```

## Test Structure

- `tests/` — mirrors `src/`, one subdirectory per domain (`utils/`, `intent/`, `embeddings/`, `fulfillment/`). Never colocate tests as `src/**/*.test.ts`; `vitest.config.ts` only includes `tests/**/*.test.ts`.
- `test-utils/` — shared fixtures exported to other packages as `@super-mcp/shared/test-utils` (ontology, sample he-retail products, a deterministic embedder).

## Writing Tests

- This package is pure, so tests need no database, no network, and no mocks — call the function and assert on the value.
- Use the deterministic hasher embedder from `test-utils/embed.ts` rather than loading a real model; a real model makes the suite slow and machine-dependent.
- Imports carry the `.js` extension even for `.ts` sources (`from "../../src/utils/units.js"`) — this is NodeNext ESM resolution, not a typo.
- Hebrew product and query strings are the normal case here; keep them literal in the test rather than transliterating.

## Workflow

- Write or update tests alongside the code they verify, not as a separate step after.
- Bug fixes: add a failing test that reproduces the bug before writing the fix.
- After implementation, run the full test suite to verify nothing else broke.

## Coverage

Not configured. Vitest's v8 coverage is not installed — add `@vitest/coverage-v8` as a dev dependency and run `vitest run --coverage` to enable it.
