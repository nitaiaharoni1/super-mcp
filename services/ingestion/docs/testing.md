# Testing

## Test Runner

Vitest 3 via `pnpm test` (`vitest run`). Prefer `pnpm test` from the repo root, which builds every package first.

## Running Tests

```bash
pnpm test                                       # Run all tests in this package
pnpm exec vitest run tests/pipeline.test.ts     # Run a single test file
pnpm exec vitest                                # Watch mode
```

## Test Structure

- `tests/` — mirrors `src/`, with `sources/`, `online/`, and `fulfillment/` subdirectories. Pipeline behaviour is split across one file per concern (`pipeline.reconcile`, `pipeline.storesGate`, `pipeline.coverageMode`, …) rather than one large file.
- `test/helpers/pipelineResult.ts` — builder for expected pipeline results, separate from the `tests/` tree.

## Writing Tests

- `@super-mcp/db` is mocked with `vi.mock`, including the batch writers (`bulkResolveProducts` and friends), whose fakes rebuild result maps the same way the real queries do so a key-format mismatch still fails.
- Feed adapters are tested against small fixture payloads, never a live FTP or HTTP source. Add a fixture rather than reaching for the network.
- Safety rails are the point of several suites (delete-ratio guards, empty-chain gates, transient-error retry). When changing one, assert on the guard firing, not just the happy path.
- Imports carry the `.js` extension even for `.ts` sources (NodeNext ESM resolution).

## Workflow

- Write or update tests alongside the code they verify, not as a separate step after.
- Bug fixes: add a failing test that reproduces the bug before writing the fix.
- After implementation, run the full test suite to verify nothing else broke.

## Coverage

Not configured. Vitest's v8 coverage is not installed — add `@vitest/coverage-v8` as a dev dependency and run `vitest run --coverage` to enable it.
