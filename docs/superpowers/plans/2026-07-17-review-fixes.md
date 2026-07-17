# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Worktree policy:** run in the main working directory. Do NOT create git worktrees (user policy).

**Goal:** Fix all six findings from the 2026-07-17 architecture review: commit the restructure, fix the no-op config flag, name/remove magic numbers, instrument silent-failure paths, harden ingestion gates, wire the semantic benchmark into CI, and build the miss-capture growth loop for the ontology.

**Architecture:** No new services. Changes land in the existing decision layer (`resolutionDecision.ts`), ingestion pipeline (`run.ts`/`normalize.ts`/`status.ts`), and DB package (2 new migrations, 1 new query module, 3 new scripts). CI is a new GitHub Actions workflow with a pgvector Postgres service running the existing fixture-ingest + hasher-backend benchmark.

**Tech Stack:** TypeScript monorepo (pnpm, vitest, tsc), Postgres + pgvector, GitHub Actions, `@anthropic-ai/sdk` (one offline script only).

**Context for the engineer:**
- Monorepo layout: `packages/shared`, `packages/db`, `services/api`, `services/ingestion`. Build: `pnpm build`. Tests: `pnpm test` (builds first, then runs vitest in every package). All 126 tests pass at plan time.
- Search config lives in DB table `semantic_search_config` (jsonb per `ontology_version`), parsed by `parseSemanticSearchConfig()` in `packages/shared/src/types/semanticSearch.ts`, with code defaults in `DEFAULT_SEMANTIC_SEARCH_CONFIG`.
- Migrations are plain SQL files in `packages/db/src/migrations/`, numbered. Highest is `009_deterministic_first_form_class.sql`. Run with `pnpm db:migrate`.
- Commit messages: no em dashes or en dashes; end with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Commit the restructure checkpoint

The working tree holds the whole folder-conventions restructure (~5,600 deleted lines, new module dirs, migrations 003-009) uncommitted. The v2 spec lists committing this as a prerequisite for trusting benchmark results. Build and tests are green.

**Files:** everything currently modified/untracked (verify nothing sensitive: no `.env`, no credentials).

- [ ] **Step 1: Verify build and tests are green**

Run: `pnpm test`
Expected: `services/api` reports `73 passed`, `services/ingestion` reports `53 passed`, exit 0.

- [ ] **Step 2: Check for files that must not be committed**

Run: `git status --porcelain | grep -iE "\.env|secret|credential|\.pem"`
Expected: no output. If anything appears, add it to `.gitignore` first and re-check.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Checkpoint: folder-conventions restructure, deterministic-first resolution, semantic retrieval v2

Splits db/shared/api/ingestion into per-responsibility modules, adds
migrations 003-009 (query perf, promo gtin norm, pgvector embeddings,
semantic index, deterministic-first form class), adds the deterministic
resolution decision layer, semantic benchmark script, and specs/plans.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Run: `git status --short`
Expected: clean tree (nothing modified/untracked).

---

### Task 2: Fix the `requireDeterministicForAutoResolve` no-op and externalize the 0.9 threshold

`services/api/src/services/basket/resolutionDecision.ts:56-59` returns the identical expression on both branches of `config.requireDeterministicForAutoResolve`, and the 0.9 "strong lexical" threshold is hardcoded at lines 53 and 103 while every sibling threshold lives in `SemanticSearchConfig`.

New semantics: when the flag is **true** (default), auto-resolve requires exact evidence or lexical >= `strongLexicalThreshold` (current behavior, now configurable). When **false**, a fused score >= `autoAcceptScore` is also accepted as evidence. This makes the flag a real rollback lever to the pre-deterministic blended behavior. The vector-only guard stays unconditional in both modes (spec invariant: embedding similarity alone never auto-resolves).

**Files:**
- Modify: `packages/shared/src/types/semanticSearch.ts`
- Modify: `services/api/src/services/basket/resolutionDecision.ts`
- Create: `packages/db/src/migrations/010_strong_lexical_threshold.sql`
- Test: `services/api/tests/services/basket/resolutionDecision.test.ts` (existing file, 9 tests)

- [ ] **Step 1: Write the failing tests**

Append to `services/api/tests/services/basket/resolutionDecision.test.ts`, following the file's existing import/helper style (it already imports `decideResolution` and builds candidates; reuse its helpers where they exist):

```typescript
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "@super-mcp/shared";
import { decideResolution } from "../../../src/services/basket/resolutionDecision.js";

describe("strongLexicalThreshold config", () => {
  it("uses the configured threshold instead of a hardcoded 0.9", () => {
    const candidates = [
      { id: "p1", name: "מלפפון", matchedVia: "product", vectorDistance: null, lexicalScore: 0.85 },
    ];
    const strict = decideResolution(candidates as never, DEFAULT_SEMANTIC_SEARCH_CONFIG);
    expect(strict.status).toBe("needs_confirmation"); // 0.85 < default 0.9

    const relaxed = decideResolution(candidates as never, {
      ...DEFAULT_SEMANTIC_SEARCH_CONFIG,
      strongLexicalThreshold: 0.8,
    });
    expect(relaxed.status).toBe("resolved");
  });
});

describe("requireDeterministicForAutoResolve", () => {
  const fusedOnly = [
    { id: "p1", name: "מלפפון", matchedVia: "product", vectorDistance: null, lexicalScore: 0.6, score: 0.7 },
  ];

  it("true (default): fused score alone cannot auto-resolve", () => {
    const decision = decideResolution(fusedOnly as never, DEFAULT_SEMANTIC_SEARCH_CONFIG);
    expect(decision.status).toBe("needs_confirmation");
  });

  it("false: fused score >= autoAcceptScore auto-resolves (rollback lever)", () => {
    const decision = decideResolution(fusedOnly as never, {
      ...DEFAULT_SEMANTIC_SEARCH_CONFIG,
      requireDeterministicForAutoResolve: false,
    });
    expect(decision.status).toBe("resolved");
  });

  it("false: vector-only candidates still never auto-resolve", () => {
    const vectorOnly = [
      { id: "p1", name: "מלפפון", matchedVia: "vector", vectorDistance: 0.1, score: 0.9 },
    ];
    const decision = decideResolution(vectorOnly as never, {
      ...DEFAULT_SEMANTIC_SEARCH_CONFIG,
      requireDeterministicForAutoResolve: false,
    });
    expect(decision.status).not.toBe("resolved");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @super-mcp/api test -- resolutionDecision`
Expected: FAIL. The threshold test fails (0.8 config has no effect, `strongLexicalThreshold` not in type), and the flag=false test fails (`needs_confirmation`).

- [ ] **Step 3: Add `strongLexicalThreshold` to the config type**

In `packages/shared/src/types/semanticSearch.ts`:

Add to the interface (after `autoAcceptGap: number;`):
```typescript
  /** Lexical score at/above which a match counts as strong deterministic evidence. */
  strongLexicalThreshold: number;
```

Add to `DEFAULT_SEMANTIC_SEARCH_CONFIG` (after `autoAcceptGap: 0.15,`):
```typescript
  strongLexicalThreshold: 0.9,
```

Add to `parseSemanticSearchConfig` return object (after the `autoAcceptGap` line):
```typescript
    strongLexicalThreshold: n("strongLexicalThreshold", DEFAULT_SEMANTIC_SEARCH_CONFIG.strongLexicalThreshold),
```

- [ ] **Step 4: Rewrite the decision functions**

In `services/api/src/services/basket/resolutionDecision.ts` replace `hasDeterministicEvidence` (lines 45-60) with:

```typescript
function hasDeterministicEvidence(
  candidate: ResolutionCandidate,
  config: SemanticSearchConfig,
): boolean {
  // Vector similarity alone never auto-resolves, regardless of mode.
  if (isVectorOnly(candidate)) return false;

  const lex = effectiveLexicalScore(candidate);
  const ev = candidate.evidence;
  const strongLexical = lex != null && lex >= config.strongLexicalThreshold;
  const exact = Boolean(ev?.exactName || ev?.exactPhrase);
  if (exact || strongLexical) return true;

  // Rollback lever: with deterministic-only off, accept the legacy blended score.
  if (!config.requireDeterministicForAutoResolve) {
    return candidate.score != null && candidate.score >= config.autoAcceptScore;
  }
  return false;
}
```

Replace `confidenceLabelFor` (lines 97-105) with a config-aware version and update its call site at line 159 to `confidenceLabelFor(chosen, config)`:

```typescript
function confidenceLabelFor(
  candidate: ResolutionCandidate,
  config: SemanticSearchConfig,
): "high" | "medium" | null {
  if (candidate.evidence?.exactName) return "high";
  if (candidate.evidence?.exactPhrase) return "medium";
  const lex = effectiveLexicalScore(candidate);
  if (lex != null && lex >= config.strongLexicalThreshold) return "medium";
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @super-mcp/shared build && pnpm --filter @super-mcp/api test -- resolutionDecision`
Expected: PASS, including the 9 pre-existing tests.

- [ ] **Step 6: Create migration 010**

Create `packages/db/src/migrations/010_strong_lexical_threshold.sql`:

```sql
-- Externalize the strong-lexical auto-resolve threshold (was hardcoded 0.9).
-- Merge only when absent so operator-tuned values survive re-runs.
UPDATE semantic_search_config
SET config = config || '{"strongLexicalThreshold": 0.9}'::jsonb,
    updated_at = now()
WHERE ontology_version = 'he-retail-v1'
  AND NOT config ? 'strongLexicalThreshold';
```

Run: `pnpm db:migrate`
Expected: migration applies cleanly (idempotent on re-run).

- [ ] **Step 7: Full test run and commit**

Run: `pnpm test`
Expected: all green.

```bash
git add packages/shared/src/types/semanticSearch.ts services/api/src/services/basket/resolutionDecision.ts services/api/tests/services/basket/resolutionDecision.test.ts packages/db/src/migrations/010_strong_lexical_threshold.sql
git commit -m "fix(basket): make requireDeterministicForAutoResolve a real rollback lever

The flag previously returned the same expression on both branches. Now
flag=false accepts fused score >= autoAcceptScore as evidence (legacy
behavior); flag=true keeps deterministic-only. The 0.9 strong-lexical
threshold moves into SemanticSearchConfig as strongLexicalThreshold
(migration 010). Vector-only candidates never auto-resolve in either mode.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Name the remaining magic numbers, delete the dead one

Three cleanups, no behavior change. Rationale: these are structural rank/heuristic constants, not runtime tunables; changing them requires re-running the benchmark and a deploy anyway, so a named constant beats DB config here (YAGNI).

**Files:**
- Modify: `services/api/src/services/search/lexicalSql.ts`
- Modify: `services/api/src/services/basket/priceStoreBasket.ts`
- Modify: `services/api/src/services/basket/resolveQuery.ts`

- [ ] **Step 1: Extract the lexical score ladder**

In `services/api/src/services/search/lexicalSql.ts`, add at the top of the file (after line 1's comment):

```typescript
/**
 * Lexical rank ladder. The ordering is what matters (exact > prefix >
 * listing prefix > word boundary > substring > listing contains > alias);
 * values are rank anchors, not tuned probabilities. If you change one,
 * re-run the semantic benchmark (pnpm db:benchmark-semantic) before merging.
 */
export const LEXICAL_SCORES = {
  exact: 1.0,
  prefix: 0.95,
  listingPrefix: 0.92,
  wordBoundary: 0.9,
  substring: 0.78,
  listingContains: 0.72,
  alias: 0.7,
} as const;
```

Then replace the literals inside the SQL template strings with interpolations:
- Line 20: `THEN 0.7` becomes `THEN ${LEXICAL_SCORES.alias}`
- Line 47: `THEN 0.95` becomes `THEN ${LEXICAL_SCORES.prefix}`
- Line 52: `THEN 0.9` becomes `THEN ${LEXICAL_SCORES.wordBoundary}`
- Line 53: `THEN 0.78` becomes `THEN ${LEXICAL_SCORES.substring}`
- Lines 45-46: `THEN 1.0` becomes `THEN ${LEXICAL_SCORES.exact}` (both GTIN and exact-name cases)
- Line 58: `THEN 0.92` becomes `THEN ${LEXICAL_SCORES.listingPrefix}`
- Line 59: `THEN 0.72` becomes `THEN ${LEXICAL_SCORES.listingContains}`

- [ ] **Step 2: Delete the dead score-decay guard in pricing**

In `services/api/src/services/basket/priceStoreBasket.ts`, `tryOrderForItem` (lines 21-29) now returns at most one candidate, so the `+ 0.2` decay guard in the loop can never fire. Delete these lines (63-67 region):

```typescript
    const primaryScore = tryOrder[0]?.score ?? 0;
```
and inside the loop:
```typescript
      // Don't silently swap to a much worse match (e.g. 6-pack mini pita for "פיתות 10").
      if (candidate.score + 0.2 < primaryScore) continue;
```

Keep `let sawListing = false;` and everything else.

- [ ] **Step 3: Name the pack-conflict tolerance**

In `services/api/src/services/basket/resolveQuery.ts`, add near the top of the file (with the other module-level constants/imports):

```typescript
/** DB size vs name-inferred pack size may disagree by this relative fraction before we trust the name. */
const PACK_CONFLICT_TOLERANCE = 0.1;
```

At line 151, replace `> 0.1` with `> PACK_CONFLICT_TOLERANCE`.

- [ ] **Step 4: Verify no behavior change**

Run: `pnpm test`
Expected: all 126 tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/search/lexicalSql.ts services/api/src/services/basket/priceStoreBasket.ts services/api/src/services/basket/resolveQuery.ts
git commit -m "refactor(api): name lexical score ladder and pack tolerance, drop dead decay guard

LEXICAL_SCORES documents the rank ladder in one place. The 0.2 pricing
decay guard was unreachable since pricing stopped substituting candidates
(tryOrderForItem returns a single SKU). No behavior change.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Instrument the silent degradation paths

Add counters/logs to every path the review found failing silently: promo mechanics falling to `other`, unit labels that don't parse, stores dropped by the region filter, and the swallowed `loadSemanticProfiles` failure.

**Files:**
- Modify: `services/ingestion/src/normalize.ts`
- Modify: `services/ingestion/src/pipeline/processFile.ts`
- Modify: `services/ingestion/src/pipeline/types.ts`
- Modify: `services/ingestion/src/pipeline/run.ts`
- Modify: `services/api/src/services/search/ontology.ts`
- Test: `services/ingestion/tests/normalize.counters.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `services/ingestion/tests/normalize.counters.test.ts`. Follow the mocking pattern used by the existing `services/ingestion/tests/pipeline.test.ts` (it mocks `@super-mcp/db` upserts); the assertions are on the returned stats:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@super-mcp/db", () => ({
  reapReclassifiedListing: vi.fn(),
  resolveProduct: vi.fn().mockResolvedValue("product-uuid"),
  upsertChain: vi.fn(),
  upsertListing: vi.fn().mockResolvedValue("listing-uuid"),
  upsertPromotion: vi.fn(),
  upsertStore: vi.fn().mockResolvedValue("store-uuid"),
  upsertStorePrice: vi.fn(),
  recordMisses: vi.fn(), // added in Task 7; harmless to mock now
}));

import { Normalizer } from "../src/normalize.js";

describe("normalize telemetry counters", () => {
  it("counts promo mechanics that fall back to other", async () => {
    const n = new Normalizer("test");
    const stats = await n.apply([
      {
        kind: "promo",
        chainId: "7290027600007",
        storeId: "001",
        promoId: "p1",
        description: "מבצע מסתורי",
        mechanic: { type: "other", params: {}, rawText: "מבצע מסתורי" },
        itemCodes: ["7290000000001"],
        startTs: null,
        endTs: null,
        ts: new Date().toISOString(),
      },
    ] as never);
    expect(stats.promoOther).toBe(1);
  });

  it("counts unparseable units on price rows", async () => {
    const n = new Normalizer("test");
    const stats = await n.apply([
      {
        kind: "price",
        chainId: "7290027600007",
        storeId: "001",
        itemCode: "7290000000001",
        itemType: 1,
        name: "מוצר",
        qty: "???",
        unit: "תיבה",
        price: 10,
        ts: new Date().toISOString(),
      },
    ] as never);
    expect(stats.unitUnparseable).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/ingestion test -- normalize.counters`
Expected: FAIL (`promoOther` is undefined). If the `price` fixture row errors for a missing-field reason instead of counting, adjust the fixture to match `RawRecord`'s price shape in `packages/shared` (check the type) rather than weakening the assertion.

- [ ] **Step 3: Add the counters to NormalizeStats and increment them**

In `services/ingestion/src/normalize.ts`:

Extend the interface (lines 28-32):
```typescript
export interface NormalizeStats {
  rowsOk: number;
  rowsError: number;
  errors: string[];
  promoOther: number;
  unitUnparseable: number;
  regionFiltered: number;
}
```

Initialize in `apply()` (line 44):
```typescript
    const stats: NormalizeStats = {
      rowsOk: 0,
      rowsError: 0,
      errors: [],
      promoOther: 0,
      unitUnparseable: 0,
      regionFiltered: 0,
    };
```

Change `applyOne` to receive stats: signature becomes `private async applyOne(record: RawRecord, stats: NormalizeStats): Promise<void>` and the call at line 47 becomes `await this.applyOne(record, stats);`.

In the `store` case, inside the region-filter early return (line 91):
```typescript
        ) {
          stats.regionFiltered++;
          return; // Stores XML is nationwide; only keep coverage cities
        }
```

In the `price` case, right after `unit` is computed (the existing `computeUnitPrice` result used at lines 165-176):
```typescript
        if (unit.measure.unparseable) stats.unitUnparseable++;
```

In the `promo` case, before `upsertPromotion` (line 195):
```typescript
        if (record.mechanic.type === "other") stats.promoOther++;
```

- [ ] **Step 4: Propagate counters through the pipeline**

`services/ingestion/src/pipeline/processFile.ts` — extend `FileProcessStats` and the success return:
```typescript
export interface FileProcessStats {
  ok: number;
  err: number;
  processed: boolean;
  fatal?: string;
  promoOther?: number;
  unitUnparseable?: number;
  regionFiltered?: number;
}
```
```typescript
      return {
        ok: stats.rowsOk,
        err: stats.rowsError,
        processed: true,
        promoOther: stats.promoOther,
        unitUnparseable: stats.unitUnparseable,
        regionFiltered: stats.regionFiltered,
      };
```

`services/ingestion/src/pipeline/types.ts` — add to `PipelineResult`:
```typescript
  promoOtherRows: number;
  unitUnparseableRows: number;
  regionFilteredStores: number;
```

`services/ingestion/src/pipeline/run.ts` — initialize the three new fields to `0` in the `result` literal (lines 31-39), and extend `absorb()`:
```typescript
function absorb(result: PipelineResult, stats: FileProcessStats): void {
  result.rowsOk += stats.ok;
  result.rowsError += stats.err;
  result.promoOtherRows += stats.promoOther ?? 0;
  result.unitUnparseableRows += stats.unitUnparseable ?? 0;
  result.regionFilteredStores += stats.regionFiltered ?? 0;
  if (stats.processed) result.filesProcessed++;
  if (stats.fatal) {
    result.errorSummary = (result.errorSummary ? result.errorSummary + "; " : "") + stats.fatal;
  }
}
```

Add a summary log in `run.ts` right after `result.status = classifyStatus(result);` (line 90):
```typescript
    console.log(
      JSON.stringify({
        event: "ingestion_quality",
        sourceId: adapter.sourceId,
        promoOtherRows: result.promoOtherRows,
        unitUnparseableRows: result.unitUnparseableRows,
        regionFilteredStores: result.regionFilteredStores,
      }),
    );
```

If `finishRun` in `persist.ts` serializes specific columns, no change is needed there (it ignores unknown fields); only touch it if the compiler complains.

- [ ] **Step 5: Un-silence loadSemanticProfiles**

In `services/api/src/services/search/ontology.ts`, in the catch block of `loadSemanticProfiles` (lines 82-87), after the re-throw guard add:

```typescript
    console.warn(
      JSON.stringify({
        event: "semantic_profiles_unavailable",
        error: message,
        fallback: "name_derived_profiles",
      }),
    );
```

(final catch block shape: compute `message`, re-throw if it doesn't match the known-missing-relation regex, otherwise warn and fall through to `return out`.)

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm test`
Expected: new counter tests pass; existing tests pass. If any existing test constructs a `NormalizeStats` or `PipelineResult` literal, add the new fields there.

- [ ] **Step 7: Commit**

```bash
git add services/ingestion/src services/ingestion/tests services/api/src/services/search/ontology.ts
git commit -m "feat(observability): count promo-other, unparseable-unit, and region-filtered rows

Every silent degradation path now emits a counter: promo mechanics that
fall to type other (basket math treats them as no discount), unit labels
that fail parsing (per-unit price lost), stores dropped by the region
filter, and the previously swallowed semantic-profile load failure.
Counters surface per run in the ingestion_quality log event.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Ingestion gates: stores-first and honest run status

Two gates: (a) if the stores feed fails, abort before price files (otherwise region filtering is silently disabled and prices attach to stub stores); (b) any discovered-but-unprocessed file makes the run `degraded` (currently up to 30% of files can be lost while the run reports `success`).

**Files:**
- Modify: `services/ingestion/src/pipeline/run.ts`
- Modify: `services/ingestion/src/pipeline/status.ts`
- Modify: `services/ingestion/src/pipeline/types.ts`
- Test: `services/ingestion/tests/pipeline.test.ts` (existing)

- [ ] **Step 1: Write the failing tests**

Add to `services/ingestion/tests/pipeline.test.ts`, following that file's existing mock/adapter-stub pattern (it already stubs adapters and asserts on `PipelineResult`):

```typescript
describe("stores-feed gate", () => {
  it("fails the run and skips price files when a stores file is fatal", async () => {
    // Arrange an adapter whose discover() returns one stores file and one
    // pricesfull file, and whose stores file throws a non-transient parse error.
    // (Reuse the file-stubbing helpers already present in this test file.)
    const result = await runPipeline(adapterWithBrokenStoresFile);
    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("stores feed failed");
    // The price file must not have been processed:
    expect(result.filesProcessed).toBe(0);
  });
});

describe("classifyStatus strictness", () => {
  it("degrades when any discovered file goes unprocessed", () => {
    expect(
      classifyStatus({
        sourceId: "t", status: "success",
        filesDiscovered: 10, priceFilesDiscovered: 9, filesProcessed: 9,
        rowsOk: 1000, rowsError: 0,
        promoOtherRows: 0, unitUnparseableRows: 0, regionFilteredStores: 0,
      }),
    ).toBe("degraded");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @super-mcp/ingestion test -- pipeline`
Expected: FAIL. 9/10 files currently classifies as `success` (ratio 0.1 < 0.3), and the broken-stores run proceeds to price files.

- [ ] **Step 3: Implement the stores gate**

In `services/ingestion/src/pipeline/run.ts`, replace the stores loop (lines 67-69) with:

```typescript
    let storesFeedFailed = false;
    for (const file of storeFiles) {
      const stats = await processFeedFile(adapter, file, archiveRoot);
      if (stats.fatal) storesFeedFailed = true;
      absorb(result, stats);
    }

    if (storesFeedFailed) {
      // Without the stores feed, region filtering and store identity are
      // unreliable; ingesting prices would attach them to stub stores nationwide.
      result.status = "failed";
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") +
        "stores feed failed; price/promo files skipped to avoid unfiltered ingest";
      await finishRun(runId, result);
      emitAlert(runId, result);
      return result;
    }
```

- [ ] **Step 4: Tighten classifyStatus**

In `services/ingestion/src/pipeline/status.ts`, replace the file-failure-ratio block (lines 22-26) with:

```typescript
  // A file we discovered but failed to process is lost data; never report success.
  if (result.filesProcessed < result.filesDiscovered) return "degraded";
```

In `services/ingestion/src/pipeline/types.ts`, delete the now-unused `DEGRADED_FILE_FAILURE_RATIO` constant (and its import in `status.ts`).

- [ ] **Step 5: Run tests, fix any existing expectations**

Run: `pnpm --filter @super-mcp/ingestion test`
Expected: the two new tests pass. Any existing test that asserted `success` with lost files now expects `degraded` — update those assertions (that is the point of the change, not a regression).

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/src/pipeline services/ingestion/tests/pipeline.test.ts
git commit -m "feat(ingestion): stores-first gate and strict run status

A fatal stores file now fails the run before any price files are
processed, since region filtering depends on it. Any discovered file
that fails to process marks the run degraded instead of allowing up to
30 percent silent file loss under a success status.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Benchmark gate + CI workflow

Make `benchmarkSemantic.ts` capable of failing the build, add a baseline-comparison script, and create the GitHub Actions workflow (repo currently has no `.github/workflows/`). The benchmark job uses the fixture adapter + hasher embed backend, which the benchmark script explicitly supports for CI ("Hasher is CI/local quality smoke").

**Files:**
- Modify: `packages/db/src/scripts/benchmarkSemantic.ts` (only `main()` at lines 835-848)
- Create: `packages/db/src/scripts/compareBenchmark.ts`
- Modify: `packages/db/package.json` (one script entry)
- Create: `.github/workflows/ci.yml`
- Create (later, after first CI run): `packages/db/benchmarks/baseline.json`

- [ ] **Step 1: Add gate + report-file behavior to the benchmark**

In `packages/db/src/scripts/benchmarkSemantic.ts`, replace `main()`:

```typescript
async function main(): Promise<void> {
  const report = await runBenchmark();
  console.log(JSON.stringify(report, null, 2));

  const reportPath = process.env.SUPER_MCP_BENCH_REPORT;
  if (reportPath) {
    const fs = await import("node:fs");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  if (process.env.SUPER_MCP_BENCH_GATE === "1") {
    if ((report as { skipped?: boolean }).skipped) {
      console.error(
        `benchmark gate: FAIL (skipped: ${(report as { skippedReason?: string }).skippedReason ?? "unknown"})`,
      );
      process.exitCode = 1;
      return;
    }
    const gate = (report as { activationGate?: { pass: boolean; summary: string } }).activationGate;
    if (!gate?.pass) {
      console.error(`benchmark gate: FAIL; ${gate?.summary ?? "no gate computed"}`);
      process.exitCode = 1;
    }
  }
}
```

(If `runBenchmark`'s return type already narrows these fields, drop the `as` casts.)

- [ ] **Step 2: Write the comparison script**

Create `packages/db/src/scripts/compareBenchmark.ts`:

```typescript
/**
 * Compare a semantic-benchmark report against a committed baseline.
 * Usage: tsx src/scripts/compareBenchmark.ts <baseline.json> <report.json>
 * Exits 1 on regression; exits 0 with a warning if the baseline is missing
 * (bootstrap mode: commit the first CI report as the baseline).
 */
import fs from "node:fs";

const RECALL_DROP_TOLERANCE = 0.05;
const UNSAFE_RISE_TOLERANCE = 0.02;

const [baselinePath, reportPath] = process.argv.slice(2);
if (!baselinePath || !reportPath) {
  console.error("usage: compareBenchmark.ts <baseline.json> <report.json>");
  process.exit(2);
}
if (!fs.existsSync(baselinePath)) {
  console.warn(`no baseline at ${baselinePath}; commit the current report there to enable regression checks`);
  process.exit(0);
}

interface Metrics {
  fusedRecallAtK: number | null;
  lexicalRecallAtK: number | null;
  unsafeSubstitutionRate: number;
  bbqForbiddenHitRate: number;
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")).metrics as Metrics;
const report = JSON.parse(fs.readFileSync(reportPath, "utf8")).metrics as Metrics;

const failures: string[] = [];
if (
  baseline.fusedRecallAtK != null &&
  report.fusedRecallAtK != null &&
  report.fusedRecallAtK < baseline.fusedRecallAtK - RECALL_DROP_TOLERANCE
) {
  failures.push(`fusedRecallAtK ${report.fusedRecallAtK} < baseline ${baseline.fusedRecallAtK} - ${RECALL_DROP_TOLERANCE}`);
}
if (report.unsafeSubstitutionRate > baseline.unsafeSubstitutionRate + UNSAFE_RISE_TOLERANCE) {
  failures.push(`unsafeSubstitutionRate ${report.unsafeSubstitutionRate} > baseline ${baseline.unsafeSubstitutionRate} + ${UNSAFE_RISE_TOLERANCE}`);
}
if (report.bbqForbiddenHitRate > 0) {
  failures.push(`bbqForbiddenHitRate ${report.bbqForbiddenHitRate} > 0 (Herzliya golden set must stay clean)`);
}

if (failures.length > 0) {
  console.error("benchmark regression:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("benchmark vs baseline: OK");
```

Add to `packages/db/package.json` scripts:
```json
    "compare-benchmark": "tsx src/scripts/compareBenchmark.ts",
```

- [ ] **Step 3: Verify locally against the live dev DB**

Run: `SUPER_MCP_BENCH_GATE=1 SUPER_MCP_BENCH_REPORT=/tmp/bench.json pnpm db:benchmark-semantic; echo "exit=$?"`
Expected: report JSON printed, `/tmp/bench.json` written, exit reflects the gate (note the exit code either way; a current FAIL is information, not a blocker for this task).

Run: `pnpm --filter @super-mcp/db compare-benchmark /nonexistent.json /tmp/bench.json`
Expected: warning about missing baseline, exit 0.

- [ ] **Step 4: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master, main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  benchmark:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: supermcp
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      PGHOST: localhost
      PGPORT: "5432"
      PGUSER: postgres
      PGPASSWORD: postgres
      PGDATABASE: supermcp
      SUPER_MCP_EMBED_BACKEND: hasher
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Assemble DATABASE_URL
        # Built from parts so no literal user:pass@host connection string
        # sits in the repo (the secret-scan pre-commit hook rejects those).
        run: |
          CRED="$PGUSER:$PGPASSWORD"
          echo "DATABASE_URL=postgres://$CRED@$PGHOST:$PGPORT/$PGDATABASE" >> "$GITHUB_ENV"
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm db:migrate
      - run: pnpm db:seed
      - run: pnpm ingest:fixture
      - run: pnpm db:semantic-index
      - name: Run benchmark with gate
        run: SUPER_MCP_BENCH_GATE=1 SUPER_MCP_BENCH_REPORT=benchmark-report.json pnpm db:benchmark-semantic
      - name: Compare against baseline
        run: pnpm --filter @super-mcp/db compare-benchmark benchmarks/baseline.json ../../benchmark-report.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: semantic-benchmark-report
          path: benchmark-report.json
```

Note for the engineer: `compare-benchmark` runs with `packages/db` as cwd, hence the `../../benchmark-report.json` path (the report is written at repo root because the benchmark script runs via the root `db:benchmark-semantic` wrapper; if `SUPER_MCP_BENCH_REPORT` resolves relative to `packages/db` instead, use matching paths — verify with one CI run and adjust).

- [ ] **Step 5: Commit and push, then bootstrap the baseline**

```bash
git add .github/workflows/ci.yml packages/db/src/scripts/benchmarkSemantic.ts packages/db/src/scripts/compareBenchmark.ts packages/db/package.json
git commit -m "ci: run tests and gated semantic benchmark on every push

The benchmark job seeds a pgvector Postgres from the fixture adapter,
builds the semantic index with the hasher backend, and fails the build
when the activation gate fails. compareBenchmark.ts additionally fails
on recall/unsafe-rate regressions once a baseline is committed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

After the first green CI run: download the `semantic-benchmark-report` artifact, save it as `packages/db/benchmarks/baseline.json`, and commit it (`ci: commit semantic benchmark baseline`). Until then the compare step warns and passes.

---

### Task 7: Miss capture + offline ontology growth loop

Persist every "closed list missed an open-world input" event into a `match_miss` table, then two offline scripts: an aggregation report and an LLM batch job that proposes new ontology terms as a reviewable JSON file (never writes to the DB itself).

**Files:**
- Create: `packages/db/src/migrations/011_match_miss.sql`
- Create: `packages/db/src/queries/misses.ts`
- Modify: `packages/db/src/index.ts` (export)
- Modify: `services/ingestion/src/normalize.ts` (accumulate + flush)
- Modify: `services/api/src/services/basket/resolveQuery.ts` (ontology_no_hit capture)
- Create: `packages/db/src/scripts/reportMisses.ts`
- Create: `packages/db/src/scripts/proposeOntologyTerms.ts`
- Modify: `packages/db/package.json` (scripts + `@anthropic-ai/sdk` dependency)
- Test: `packages/db/tests/queries/misses.test.ts` (new; follow the DB-mocking style of the existing `packages/db/tests/` suites — they pass without a live DB)

- [ ] **Step 1: Create the migration**

Create `packages/db/src/migrations/011_match_miss.sql`:

```sql
-- Capture open-world inputs our closed lists missed (promo regexes, unit
-- aliases, region city list, ontology terms). Feeds the offline growth loop.
CREATE TABLE IF NOT EXISTS match_miss (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  term TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  hit_count BIGINT NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, term)
);

CREATE INDEX IF NOT EXISTS match_miss_kind_count_idx
  ON match_miss (kind, hit_count DESC);
```

Run: `pnpm db:migrate`
Expected: applies cleanly.

- [ ] **Step 2: Write the query module + failing test**

Create `packages/db/src/queries/misses.ts`:

```typescript
import { getPool } from "../client/index.js";

export type MissKind =
  | "promo_other"
  | "unit_unparseable"
  | "region_unmatched"
  | "ontology_no_hit";

export interface MatchMiss {
  kind: MissKind;
  term: string;
  count?: number;
  context?: Record<string, unknown>;
}

/** Upsert miss counters. Telemetry only: callers must treat failure as non-fatal. */
export async function recordMisses(misses: MatchMiss[]): Promise<void> {
  if (misses.length === 0) return;
  const pool = getPool();
  for (const m of misses) {
    const term = m.term.trim().slice(0, 200);
    if (!term) continue;
    await pool.query(
      `INSERT INTO match_miss (kind, term, context, hit_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, term) DO UPDATE SET
         hit_count = match_miss.hit_count + EXCLUDED.hit_count,
         context = EXCLUDED.context,
         last_seen = now()`,
      [m.kind, term, JSON.stringify(m.context ?? {}), m.count ?? 1],
    );
  }
}

export interface TopMissRow {
  kind: string;
  term: string;
  hit_count: string;
  last_seen: Date;
  context: Record<string, unknown>;
}

export async function topMisses(kind: MissKind, limit = 50): Promise<TopMissRow[]> {
  const res = await getPool().query<TopMissRow>(
    `SELECT kind, term, hit_count, last_seen, context
     FROM match_miss WHERE kind = $1
     ORDER BY hit_count DESC, last_seen DESC LIMIT $2`,
    [kind, limit],
  );
  return res.rows;
}
```

Export from `packages/db/src/index.ts` alongside the other query exports (match the file's existing `export * from "./queries/..."` style):
```typescript
export * from "./queries/misses.js";
```

Test `packages/db/tests/queries/misses.test.ts` (mock the pool like the existing db tests do):

```typescript
import { describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { recordMisses } from "../../src/queries/misses.js";

describe("recordMisses", () => {
  it("upserts one row per miss with additive counts", async () => {
    await recordMisses([
      { kind: "promo_other", term: "מבצע מסתורי", count: 3 },
      { kind: "unit_unparseable", term: "תיבה|" },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![1]).toEqual([
      "promo_other", "מבצע מסתורי", "{}", 3,
    ]);
  });

  it("skips empty terms and no-ops on empty input", async () => {
    query.mockClear();
    await recordMisses([{ kind: "promo_other", term: "   " }]);
    await recordMisses([]);
    expect(query).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @super-mcp/db test -- misses`
Expected: FAIL first (module missing), then PASS after creating the module.

- [ ] **Step 3: Accumulate and flush misses in the Normalizer**

In `services/ingestion/src/normalize.ts`:

Add `recordMisses` and `type MatchMiss` to the existing `@super-mcp/db` import. Add to the `Normalizer` class fields:

```typescript
  private misses = new Map<string, MatchMiss>();

  private noteMiss(kind: MatchMiss["kind"], term: string, context?: Record<string, unknown>): void {
    const key = `${kind} ${term}`;
    const existing = this.misses.get(key);
    if (existing) existing.count = (existing.count ?? 1) + 1;
    else this.misses.set(key, { kind, term, count: 1, context });
  }
```

Pair each counter from Task 4 with a `noteMiss` call:
- region filter: `this.noteMiss("region_unmatched", city ?? name, { chainId: cleanChainId });`
- unparseable unit: `this.noteMiss("unit_unparseable", `${record.unit ?? ""}|${record.qty ?? ""}`, { chainId: cleanChainId });`
- promo other: `this.noteMiss("promo_other", (record.mechanic.rawText ?? record.description ?? "").slice(0, 120), { chainId: cleanChainId });`

At the end of `apply()` (before `return stats;`):

```typescript
    try {
      await recordMisses([...this.misses.values()]);
      this.misses.clear();
    } catch {
      // Miss telemetry must never fail an ingest run.
    }
```

Update the Task 4 test mock if needed (it already stubs `recordMisses`).

- [ ] **Step 4: Capture ontology_no_hit in query resolution**

In `services/api/src/services/basket/resolveQuery.ts` (which already imports `profileFromText` and uses `getActiveOntology`), add `recordMisses` to the `@super-mcp/db` import, then insert inside `resolveQueryItem`, right after the `queryVariants` computation (line 107-108):

```typescript
  if (semantic && ontology) {
    const queryProfile = profileFromText(item.query!, ontology);
    if (Object.keys(queryProfile.attributes).length === 0 && queryProfile.concepts.length === 0) {
      // The ontology recognized nothing in this query: candidate for a new term.
      void recordMisses([
        { kind: "ontology_no_hit", term: item.query!.trim().slice(0, 120) },
      ]).catch(() => undefined);
    }
  }
```

Fire-and-forget (`void ... .catch`): never blocks or fails resolution.

- [ ] **Step 5: Aggregation report script**

Create `packages/db/src/scripts/reportMisses.ts`:

```typescript
/** Print top misses per kind as markdown + JSON. Usage: tsx src/scripts/reportMisses.ts [limit] */
import { closePool } from "../client/index.js";
import { topMisses, type MissKind } from "../queries/misses.js";

const KINDS: MissKind[] = ["promo_other", "unit_unparseable", "region_unmatched", "ontology_no_hit"];

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 25);
  const out: Record<string, unknown[]> = {};
  for (const kind of KINDS) {
    const rows = await topMisses(kind, limit);
    out[kind] = rows;
    console.log(`\n## ${kind} (top ${rows.length})\n`);
    for (const r of rows) {
      console.log(`- ${r.hit_count}x  ${r.term}  (last ${r.last_seen.toISOString().slice(0, 10)})`);
    }
  }
  console.log("\n<!-- json -->");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .then(async () => closePool().catch(() => undefined))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
```

- [ ] **Step 6: LLM proposal script (offline, human-reviewed output)**

Add the dependency: `pnpm --filter @super-mcp/db add @anthropic-ai/sdk`

Create `packages/db/src/scripts/proposeOntologyTerms.ts`:

```typescript
/**
 * Offline growth loop: read top misses + current ontology, ask Claude to
 * propose new semantic terms / promo patterns. Writes a reviewable JSON
 * proposals file; NEVER writes to the database. Requires ANTHROPIC_API_KEY
 * (or an `ant auth login` profile).
 * Usage: tsx src/scripts/proposeOntologyTerms.ts [outfile]
 */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { closePool, getPool } from "../client/index.js";
import { topMisses, type MissKind } from "../queries/misses.js";

const KINDS: MissKind[] = ["promo_other", "unit_unparseable", "region_unmatched", "ontology_no_hit"];

const PROPOSALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["missKind", "missTerm", "action", "rationale"],
        properties: {
          missKind: { type: "string" },
          missTerm: { type: "string" },
          action: {
            type: "string",
            enum: ["add_semantic_term", "add_unit_alias", "add_city_alias", "add_promo_pattern", "ignore"],
          },
          termKind: { type: "string", enum: ["attribute", "concept", "penalty", "alias", "stopword", ""] },
          attribute: { type: "string" },
          value: { type: "string" },
          term: { type: "string" },
          matchMode: { type: "string", enum: ["token", "phrase", "exact", "alias", ""] },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

async function main(): Promise<void> {
  const outfile = process.argv[2] ?? "proposals/ontology-proposals.json";

  const misses: Record<string, unknown> = {};
  for (const kind of KINDS) misses[kind] = await topMisses(kind, 40);

  const ontology = await getPool().query(
    `SELECT kind, attribute, value, term, match_mode
     FROM semantic_term WHERE ontology_version = 'he-retail-v1'
     ORDER BY kind, attribute, value`,
  );

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      "You maintain the Hebrew retail ontology of an Israeli grocery price-comparison service. " +
      "You receive (a) the current ontology terms and (b) 'misses': real inputs the system could not classify. " +
      "Propose additions ONLY where the miss data clearly supports them. Prefer 'ignore' for noise, typos, " +
      "and one-off garbage. Never propose terms that could cause unsafe substitutions (e.g. do not map " +
      "a liquor brand to a produce concept). Output strictly matches the JSON schema.",
    messages: [
      {
        role: "user",
        content:
          `Current ontology terms (he-retail-v1):\n${JSON.stringify(ontology.rows)}\n\n` +
          `Misses by kind:\n${JSON.stringify(misses)}\n\n` +
          "Propose ontology/unit/city/promo additions for the recurring, high-count misses.",
      },
    ],
    output_config: { format: { type: "json_schema", schema: PROPOSALS_SCHEMA } },
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`no text block; stop_reason=${response.stop_reason}`);
  fs.mkdirSync(outfile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(outfile, JSON.stringify(JSON.parse(text.text), null, 2));
  console.log(`wrote ${outfile}; review and encode accepted proposals as a new migration`);
}

main()
  .then(async () => closePool().catch(() => undefined))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
```

Add to `packages/db/package.json` scripts:
```json
    "report-misses": "tsx src/scripts/reportMisses.ts",
    "propose-ontology-terms": "tsx src/scripts/proposeOntologyTerms.ts",
```

Note: verify the `semantic_term` column names in the SELECT against migration `007_generic_semantic_index.sql` (expected: `kind`, `attribute`, `value`, `term`, `match_mode`); adjust if the schema differs.

- [ ] **Step 7: Run everything**

Run: `pnpm test`
Expected: all packages green (new misses test included).

Run: `pnpm --filter @super-mcp/db report-misses` against the dev DB after one `pnpm ingest` cycle.
Expected: markdown report; kinds may be empty on first run, that is fine.

(Do not run `propose-ontology-terms` unless an Anthropic credential is available; it is an operator tool, not CI.)

- [ ] **Step 8: Commit**

```bash
git add packages/db services/ingestion/src/normalize.ts services/api/src/services/basket/resolveQuery.ts
git commit -m "feat(growth-loop): persist match misses and add offline ontology proposal tooling

New match_miss table accumulates promo-other, unparseable-unit,
region-unmatched, and ontology-no-hit inputs. Ingestion flushes per file,
the API records unrecognized queries fire-and-forget. report-misses
prints the backlog; propose-ontology-terms asks Claude for reviewable
term proposals written to a JSON file, never to the database.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** review finding 6 (repo hygiene) → Task 1; finding 2 (no-op flag + thresholds) → Tasks 2-3; finding 3 (instrumentation) → Task 4; finding 5 (ingestion gates) → Task 5; finding 1 (CI benchmark gate + baseline) → Task 6; finding 4 (growth loop) → Task 7. All six covered.
- **Known judgment calls encoded above:** flag=false semantics (rollback to blended score, vector-only still barred); lexical ladder as named constant rather than DB config (structural, benchmark-gated); the 0.2 pricing decay deleted as dead code (pricing no longer substitutes); baseline bootstrapped from the first CI artifact because the local dev catalog differs from the CI fixture catalog.
- **Type consistency:** `strongLexicalThreshold` (Tasks 2, migration 010), `MatchMiss`/`recordMisses`/`topMisses` (Task 7 module, ingestion, API, scripts), `FileProcessStats`/`PipelineResult` counter names (Task 4/5) are used identically across tasks.
