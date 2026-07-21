# Generic Semantic Retrieval V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lexical-anchor-dependent semantics and hardcoded attribute policy with cached query embeddings, complete product profiles, and a generic database-defined constraint engine.

**Architecture:** Recall merges direct query-to-product vector search with independent lexical search. A generic policy layer evaluates only explicit query constraints using versioned attribute metadata, then commerce ranking applies local availability, pack fit, price, and calibrated confidence.

**Tech Stack:** TypeScript 7, Node 22+, pnpm, PostgreSQL 17, pgvector, `@huggingface/transformers`, Vitest.

## Global Constraints

- Keep GTIN, `product`, `listing`, prices, and promotions unchanged.
- Product embeddings run only offline or after product data changes.
- Query embeddings may run on cache miss and must be cached by normalized query hash and model version.
- Embeddings improve recall/ranking but never override explicit hard constraints.
- The semantic engine must not branch on Hebrew terms, product categories, or attribute names.
- The database ontology is the single source of truth; no hand-maintained production fallback fixture.
- Preserve lexical-only fallback when embeddings or ontology are unavailable.
- Do not edit prior plan files.
- Do not create commits unless the user explicitly requests them.

---

## File Structure

**Create**

- `packages/db/src/migrations/008_semantic_retrieval_v2.sql` — attribute policy, match modes, full profiles, query cache, search config.
- `packages/shared/src/intent/tokenMatcher.ts` — locale-aware token and phrase matching.
- `packages/shared/src/types/semanticSearch.ts` — generic search configuration and query embedding types.
- `packages/db/src/queries/semantic/queryCache.ts` — query embedding cache reads/writes.
- `services/api/src/services/search/queryEmbedding.ts` — cache-first query embedding service.
- `services/api/src/services/search/vectorSearch.ts` — direct query-to-product ANN query.
- `services/api/src/services/search/rankFusion.ts` — deterministic reciprocal-rank fusion.
- `services/api/tests/services/search/queryEmbedding.test.ts`
- `services/api/tests/services/search/rankFusion.test.ts`
- `services/api/tests/services/search/vectorSearch.test.ts`

**Modify**

- `packages/shared/src/types/semanticTypes.ts`
- `packages/shared/src/intent/semanticMatcher.ts`
- `packages/shared/src/index.ts`
- `packages/db/src/queries/semantic/types.ts`
- `packages/db/src/queries/semantic/ontology.ts`
- `packages/db/src/queries/semantic/drain.ts`
- `packages/db/src/queries/semantic/embedder.ts`
- `packages/db/src/queries/semantic/index.ts`
- `services/api/src/services/search/ontology.ts`
- `services/api/src/services/search/lexicalSql.ts`
- `services/api/src/services/search/scoredSearch.ts`
- `services/api/src/services/search/intentRank.ts`
- `services/api/src/services/search/types.ts`
- `services/api/src/services/basket/resolveQuery.ts`
- `services/api/src/services/basket/constants.ts`
- `packages/db/src/scripts/benchmarkSemantic.ts`
- `README.md`

**Remove after cutover**

- `packages/shared/src/intent/heRetailOntology.ts`
- duplicate or incorrectly located tests under `services/api/src/**.test.ts` and `services/ingestion/src/**.test.ts`.

---

### Task 1: Stabilize Repository and Test Baseline

**Files:**
- Modify: `services/api/tests/services/basket.intent.test.ts`
- Modify: `services/api/vitest.config.ts`
- Modify: `services/ingestion/vitest.config.ts`
- Remove: duplicate tests after selecting `tests/**` as the canonical location

**Interfaces:**
- Produces: one authoritative test tree per package and a clean root verification baseline.

- [ ] **Step 1: Reproduce the current root failure**

Run:

```bash
pnpm test
```

Expected: failure from the bad relative import in `services/api/tests/services/basket.intent.test.ts`, or another concrete baseline failure recorded before edits.

- [ ] **Step 2: Fix the API test import**

Change the import to resolve from the API package:

```ts
import { rankHitsForIntent } from "../../src/services/search/intentRank.js";
```

Use the actual relative depth confirmed by the test file location; verify it resolves to `services/api/src/services/search/intentRank.ts`.

- [ ] **Step 3: Consolidate test discovery**

Configure both API and ingestion Vitest to use:

```ts
test: {
  include: ["tests/**/*.test.ts"],
}
```

Move any unique `src/**/*.test.ts` coverage into the matching `tests/` folder, then delete duplicates.

- [ ] **Step 4: Verify from a clean build output**

Run:

```bash
rm -rf packages/*/dist services/*/dist
pnpm build
pnpm test
pnpm -r run typecheck
```

Expected: all commands pass. If unrelated baseline failures remain, record them and fix only import/layout issues that block semantic work.

---

### Task 2: Add Generic Policy, Query Cache, and Full Profile Schema

**Files:**
- Create: `packages/db/src/migrations/008_semantic_retrieval_v2.sql`
- Modify: `packages/shared/src/types/semanticTypes.ts`
- Create: `packages/shared/src/types/semanticSearch.ts`

**Interfaces:**
- Produces:

```ts
type SemanticMatchMode = "token" | "phrase" | "exact" | "alias";

interface SemanticAttributeDefinition {
  attribute: string;
  constraintStrength: "hard" | "soft" | "ranking";
  missingValueBehavior: "allow" | "relax" | "reject";
  enablesNearbyAlternative: boolean;
  conflictPolicy: "different_value" | "explicit_pairs";
}

interface SemanticSearchConfig {
  vectorLimit: number;
  vectorDistanceMax: number;
  lexicalLimit: number;
  trigramThreshold: number;
  vectorRrfWeight: number;
  lexicalRrfWeight: number;
  rrfK: number;
  autoAcceptScore: number;
  autoAcceptGap: number;
  nearbyAlternativesEnabled: boolean;
}
```

- [ ] **Step 1: Write migration integration assertions**

Extend `packages/db/tests/semanticIndex.test.ts` to assert:

```ts
expect(attributeDef.constraint_strength).toBe("hard");
expect(term.match_mode).toBe("phrase");
expect(config.vector_limit).toBeGreaterThan(0);
```

Also assert query cache uniqueness on `(query_hash, model)`.

- [ ] **Step 2: Run the DB test and confirm schema assertions fail**

Run:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/super_mcp \
  pnpm --filter @super-mcp/db test
```

Expected: failure because migration 008 tables/columns do not exist.

- [ ] **Step 3: Implement migration 008**

Add:

```sql
CREATE TABLE semantic_attribute_definition (
  ontology_version TEXT NOT NULL REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,
  constraint_strength TEXT NOT NULL CHECK (constraint_strength IN ('hard','soft','ranking')),
  missing_value_behavior TEXT NOT NULL CHECK (missing_value_behavior IN ('allow','relax','reject')),
  enables_nearby_alternative BOOLEAN NOT NULL DEFAULT false,
  conflict_policy TEXT NOT NULL CHECK (conflict_policy IN ('different_value','explicit_pairs')),
  PRIMARY KEY (ontology_version, attribute)
);

ALTER TABLE semantic_term
  ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'token'
  CHECK (match_mode IN ('token','phrase','exact','alias')),
  ADD COLUMN priority INT NOT NULL DEFAULT 0;

ALTER TABLE product_semantic_profile
  ADD COLUMN penalties TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN concept_terms TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE semantic_query_embedding (
  query_hash TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (query_hash, model)
);

CREATE TABLE semantic_search_config (
  ontology_version TEXT PRIMARY KEY REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seed attribute definitions and configuration for `he-retail-v1`. The seed may name domain attributes; engine code may not.

- [ ] **Step 4: Update shared types**

Extend `OntologySnapshot`:

```ts
export interface OntologySnapshot {
  version: string;
  locale: string;
  terms: OntologyTerm[];
  relaxations: OntologyRelaxation[];
  attributes: SemanticAttributeDefinition[];
  searchConfig: SemanticSearchConfig;
}
```

Add `matchMode` and `priority` to `OntologyTerm`.

- [ ] **Step 5: Apply migration and verify**

Run:

```bash
pnpm db:migrate
DATABASE_URL=postgresql://postgres@localhost:5432/super_mcp \
  pnpm --filter @super-mcp/db test
```

Expected: migration applies once and tests pass.

---

### Task 3: Replace Substring Matching with Token/Phrase Matching

**Files:**
- Create: `packages/shared/src/intent/tokenMatcher.ts`
- Modify: `packages/shared/src/intent/semanticMatcher.ts`
- Test: `packages/shared/tests/intent/semanticMatcher.test.ts`

**Interfaces:**
- Produces:

```ts
interface SemanticTermMatch {
  term: OntologyTerm;
  surface: string;
  tokenStart: number;
  tokenEnd: number;
}

function matchOntologyTerms(
  text: string,
  ontology: OntologySnapshot,
): SemanticTermMatch[];
```

- [ ] **Step 1: Add failing boundary tests**

Test:

```ts
it("does not match a token inside another token", () => {
  expect(matchOntologyTerms("brandword", ontologyWithTerm("and"))).toEqual([]);
});

it("prefers the longest non-overlapping phrase", () => {
  const matches = matchOntologyTerms("alpha beta product", ontology);
  expect(matches.map((m) => m.surface)).toEqual(["alpha beta"]);
});

it("matches a configured multi-token phrase", () => {
  expect(matchOntologyTerms("עוף טוב שניצל", ontology)[0]?.surface).toBe("עוף טוב");
});
```

- [ ] **Step 2: Run shared tests and confirm failure**

Run:

```bash
pnpm --filter @super-mcp/shared test
```

Expected: missing matcher or boundary assertion failures.

- [ ] **Step 3: Implement generic token matching**

Use `Intl.Segmenter` when available, with normalized whitespace-token fallback:

```ts
const segmenter = new Intl.Segmenter(ontology.locale, { granularity: "word" });
```

Match `token`, `phrase`, and `exact` modes. Sort candidates by:

1. higher `priority`;
2. longer token span;
3. longer normalized term;

then select non-overlapping spans.

- [ ] **Step 4: Refactor semantic matcher**

Replace every `normalized.includes(needle)` path in:

- profile extraction;
- implications;
- query aliases;
- penalties;

with `matchOntologyTerms()`.

Derive constraint strength and nearby-alternative behavior from `ontology.attributes`, not attribute names:

```ts
const definition = attributeDefinitions.get(attribute);
const strength = definition?.constraintStrength ?? "ranking";
```

Delete special branches for `kosher`, `cut`, and `species`.

- [ ] **Step 5: Verify generic and Hebrew fixture tests**

Run:

```bash
pnpm --filter @super-mcp/shared test
pnpm --filter @super-mcp/shared typecheck
```

Expected: tests pass without any attribute-name branch in `semanticMatcher.ts`.

---

### Task 4: Persist and Load Complete Product Profiles

**Files:**
- Modify: `packages/db/src/queries/semantic/drain.ts`
- Modify: `packages/db/src/queries/semantic/ontology.ts`
- Modify: `services/api/src/services/search/ontology.ts`
- Test: `packages/db/tests/semanticIndex.test.ts`

**Interfaces:**
- Produces:

```ts
interface StoredSemanticProfile extends SemanticProfile {
  productId: string;
  ontologyVersion: string;
  inputHash: string;
}

function loadSemanticProfiles(
  productIds: string[],
  ontologyVersion: string,
): Promise<Map<string, SemanticProfile>>;
```

- [ ] **Step 1: Add failing round-trip test**

Index a product containing a penalty and a stopword, then assert:

```ts
expect(profile.penalties).toContain("variant:spicy");
expect(profile.conceptTerms).not.toContain("fresh");
```

- [ ] **Step 2: Update index write**

Write all profile fields atomically:

```sql
INSERT INTO product_semantic_profile
  (product_id, ontology_version, attributes, concepts, penalties, concept_terms, input_hash, profiled_at)
VALUES ($1, $2, $3::jsonb, $4::text[], $5::text[], $6::text[], $7, now())
```

- [ ] **Step 3: Update profile reads**

Return the complete shared `SemanticProfile` shape. Remove runtime reconstruction:

```ts
conceptTerms: hit.name.toLowerCase().split(/\s+/)
```

- [ ] **Step 4: Verify idempotence**

Run the dirty drain twice. First run must write; second run must skip based on matching input hash while leaving the complete profile unchanged.

---

### Task 5: Add Cache-First Query Embeddings

**Files:**
- Create: `packages/db/src/queries/semantic/queryCache.ts`
- Modify: `packages/db/src/queries/semantic/embedder.ts`
- Modify: `packages/db/src/queries/semantic/index.ts`
- Create: `services/api/src/services/search/queryEmbedding.ts`
- Test: `services/api/tests/services/search/queryEmbedding.test.ts`

**Interfaces:**
- Produces:

```ts
interface QueryEmbeddingResult {
  vector: number[];
  model: string;
  queryHash: string;
  cacheHit: boolean;
}

function getQueryEmbedding(query: string): Promise<QueryEmbeddingResult>;
```

- [ ] **Step 1: Add failing cache tests**

Mock the model embedder:

```ts
const first = await getQueryEmbedding("  Olive   Oil ");
const second = await getQueryEmbedding("olive oil");

expect(first.cacheHit).toBe(false);
expect(second.cacheHit).toBe(true);
expect(embedder).toHaveBeenCalledTimes(1);
```

Also test model-version isolation and lexical fallback on embedder failure.

- [ ] **Step 2: Extract reusable embedder**

Expose:

```ts
export async function embedText(text: string, model: string): Promise<number[]>;
```

Keep the model pipeline singleton per process. Validate exactly 384 finite dimensions and L2 normalization.

- [ ] **Step 3: Implement query cache repository**

Provide:

```ts
getCachedQueryEmbedding(queryHash: string, model: string): Promise<number[] | null>;
putCachedQueryEmbedding(input: {
  queryHash: string;
  normalizedQuery: string;
  model: string;
  vector: number[];
}): Promise<void>;
```

Increment `hits` on cache read.

- [ ] **Step 4: Implement cache-first service**

Normalize with the same `normalizeEmbedInput()` used for products, hash normalized query + model, read cache, embed on miss, then upsert.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @super-mcp/api test -- queryEmbedding
pnpm --filter @super-mcp/api typecheck
```

Expected: one model call for repeated normalized query and distinct cache entries per model.

---

### Task 6: Implement Direct Vector Recall and Rank Fusion

**Files:**
- Create: `services/api/src/services/search/vectorSearch.ts`
- Create: `services/api/src/services/search/rankFusion.ts`
- Modify: `services/api/src/services/search/lexicalSql.ts`
- Modify: `services/api/src/services/search/scoredSearch.ts`
- Modify: `services/api/src/services/search/types.ts`
- Test: `services/api/tests/services/search/vectorSearch.test.ts`
- Test: `services/api/tests/services/search/rankFusion.test.ts`

**Interfaces:**
- Produces:

```ts
interface RetrievalCandidate extends SearchProductHit {
  lexicalRank: number | null;
  vectorRank: number | null;
  vectorDistance: number | null;
  fusedScore: number;
}

function searchByQueryVector(input: {
  vector: number[];
  model: string;
  limit: number;
  maxDistance: number;
  location: SearchLocationScope;
}): Promise<SearchProductHit[]>;

function fuseRankedCandidates(
  lexical: SearchProductHit[],
  vector: SearchProductHit[],
  config: SemanticSearchConfig,
): RetrievalCandidate[];
```

- [ ] **Step 1: Add failing ANN query test**

Seed two product vectors and assert direct query-vector search returns the nearest product without a lexical anchor.

- [ ] **Step 2: Implement direct pgvector search**

Use:

```sql
SELECT p.*, pe.embedding <=> $1::vector AS vector_distance
FROM product_embedding pe
JOIN product p ON p.id = pe.product_id
WHERE pe.model = $2
  AND pe.embedding <=> $1::vector <= $3
ORDER BY pe.embedding <=> $1::vector
LIMIT $4
```

Attach `has_price` and `has_local_price` using the existing scoped price SQL.

- [ ] **Step 3: Add failing RRF tests**

Test lexical-only, vector-only, overlap, stable tie-break, and configurable weights:

```ts
expect(fused[0]?.id).toBe("present-in-both");
expect(fused.find((x) => x.id === "vector-only")).toBeDefined();
```

- [ ] **Step 4: Implement weighted reciprocal-rank fusion**

Use:

```ts
score += weight / (config.rrfK + rank);
```

Do not blend raw trigram and cosine scores directly.

- [ ] **Step 5: Replace lexical-anchor vector expansion**

In `scoredSearch.ts`, run lexical and vector recall independently, in parallel:

```ts
const [lexical, queryEmbedding] = await Promise.all([
  searchLexical(params, config.lexicalLimit),
  getQueryEmbedding(params.q),
]);
```

Run vector search from the query vector, then fuse. Delete `buildVectorExpansionCte()` after shadow comparison confirms parity.

- [ ] **Step 6: Move thresholds out of SQL**

Pass trigram threshold, candidate limits, and vector distance from `SemanticSearchConfig`. Remove `0.4`, `0.45`, `40`, and score-weight constants from `lexicalSql.ts`.

---

### Task 7: Make Constraint Policy Fully Data-Driven

**Files:**
- Modify: `services/api/src/services/search/intentRank.ts`
- Modify: `services/api/src/services/basket/resolveQuery.ts`
- Modify: `services/api/src/services/basket/constants.ts`
- Test: `services/api/tests/services/search/intentRank.test.ts`
- Test: `services/api/tests/services/basket/basket.intent.test.ts`

**Interfaces:**
- Consumes: complete profiles, `OntologySnapshot.attributes`, fused candidates.
- Produces: ranked candidates and explicit substitution metadata.

- [ ] **Step 1: Add generic policy tests**

Use synthetic attributes named `temperature` and `material`, not food terms:

```ts
expect(rank(queryHardConflict).ranked).toHaveLength(0);
expect(rank(querySoftMissing).ranked[0]?.intentTier).toBe(2);
```

Test that inferred constraints never hard-reject.

- [ ] **Step 2: Refactor gating**

For each explicit query constraint:

1. load its `SemanticAttributeDefinition`;
2. apply configured missing-value behavior;
3. compare values using configured conflict policy;
4. apply a relaxation only when a matching ontology row exists.

Tier 3 eligibility comes from `enablesNearbyAlternative`, never:

```ts
queryAttrs.has("cut") || queryAttrs.has("species")
```

- [ ] **Step 3: Load full profiles before ranking**

Ensure `resolveQuery.ts` passes the complete profile map to `rankHitsForIntent()`. If profile coverage is below configured minimum, use lexical/fused ranking without hard gating and emit a structured fallback event.

- [ ] **Step 4: Move basket constants into configuration**

Replace `AUTO_ACCEPT_SCORE`, `AUTO_ACCEPT_GAP`, and `SEMANTIC_CANDIDATE_LIMIT` with fields from the active `SemanticSearchConfig`.

- [ ] **Step 5: Preserve strict identity and substitutions**

Verify:

- explicit GTIN and product UUID never substitute;
- free-text substitutions include original and selected products;
- `changedAttributes` comes from relaxation/conflict evaluation;
- confidence indicates whether vector, lexical, or both retrieval paths supported the choice.

---

### Task 8: Remove Stale Fixture Fallback and Add Observability

**Files:**
- Modify: `services/api/src/services/search/ontology.ts`
- Remove: `packages/shared/src/intent/heRetailOntology.ts`
- Modify: `services/api/src/services/search/scoredSearch.ts`
- Modify: `services/api/src/services/basket/resolveQuery.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: lexical-only fallback and structured semantic health events.

- [ ] **Step 1: Add fallback tests**

Test ontology load failure, query embed failure, model mismatch, and insufficient profile coverage. Each must return lexical candidates and emit one structured event.

- [ ] **Step 2: Remove production fixture fallback**

Change ontology load failure behavior:

```ts
return null;
```

Callers must disable semantic gating and vector configuration for that request. Keep synthetic snapshots only inside tests.

- [ ] **Step 3: Add structured events**

Emit:

```ts
{
  event: "semantic_search",
  model,
  ontologyVersion,
  queryCacheHit,
  lexicalCandidates,
  vectorCandidates,
  fusedCandidates,
  profileCoverage,
  fallbackReason,
  durationMs
}
```

Never log raw query text unless explicitly enabled.

- [ ] **Step 4: Document operations**

Document query cache, model cache location, model/ontology cutover, fallback behavior, configuration, and metrics.

---

### Task 9: Benchmark, Shadow Rollout, and Legacy Removal

**Files:**
- Modify: `packages/db/src/scripts/benchmarkSemantic.ts`
- Create: `packages/db/tests/fixtures/semantic-benchmark.json`
- Modify: `services/api/src/lib/features.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: repeatable quality report and staged feature flags.

- [ ] **Step 1: Build representative labeled fixture**

Include at least:

- meat, dairy, produce, pantry;
- brands and pack sizes;
- explicit dietary/freshness/species constraints;
- unknown synonyms and misspellings;
- unsafe negative substitutions;
- local-stock and no-local-stock cases.

Each fixture row contains:

```ts
{
  query: string;
  location: { city?: string; near?: { lat: number; lng: number } };
  acceptableProductIds: string[];
  forbiddenProductIds: string[];
}
```

- [ ] **Step 2: Expand benchmark metrics**

Report:

- lexical recall@K;
- vector recall@K;
- fused recall@K;
- local top-1 resolution;
- unsafe substitution rate;
- missing-line rate;
- query cache hit rate;
- p50/p95 latency;
- vector/profile coverage and dirty age.

- [ ] **Step 3: Add staged flags**

Use:

```text
SUPER_MCP_SEMANTIC_V2_SHADOW=1
SUPER_MCP_SEMANTIC_V2_RECALL=1
SUPER_MCP_SEMANTIC_V2_POLICY=1
```

Shadow mode computes V2 but returns the existing result.

- [ ] **Step 4: Define activation gates**

Enable V2 recall only when:

- vector/profile coverage meets configured minimum;
- unsafe substitution rate does not regress;
- fused recall@K improves over lexical recall@K;
- p95 latency remains within the documented budget.

- [ ] **Step 5: Remove legacy paths after cutover**

Delete:

- lexical-anchor product-neighbor expansion;
- substring ontology matching;
- attribute-name policy branches;
- fixture fallback;
- obsolete feature flags and duplicate tests.

- [ ] **Step 6: Final verification**

Run:

```bash
rm -rf packages/*/dist services/*/dist
pnpm db:migrate
pnpm build
pnpm test
pnpm -r run typecheck
pnpm db:benchmark-semantic
```

Expected: all checks pass; benchmark prints V1/V2 comparisons and activation metrics.

