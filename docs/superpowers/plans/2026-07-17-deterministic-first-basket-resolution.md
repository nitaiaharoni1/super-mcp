# Deterministic-First Basket Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make basket free-text resolution safe and fast by deciding with deterministic evidence first and using embeddings only as fallback recall.

**Architecture:** Query profiles and form/class attributes live in the ontology. Lexical search returns evidence-rich hits. Compatibility gates reject processed/wrong-class lookalikes. Ranking uses lexicographic decision classes with local stock as a late tie-break. Embeddings run only when deterministic recall is weak. Pricing skips misleading cheapest-store claims until enough lines resolve safely.

**Tech Stack:** TypeScript 7, Node 22+, pnpm, PostgreSQL 17, pgvector, Vitest.

## Global Constraints

- Keep GTIN, `product`, `listing`, prices, and promotions unchanged.
- Wrong product is worse than unresolved; never invent a “local equivalent” below the confidence floor.
- The semantic engine must not branch on Hebrew terms or attribute names; policy comes from ontology rows.
- Embeddings generate candidates only; they never auto-resolve a line by themselves.
- Product and query vectors must share model, backend, dims, and generation; mismatch disables vector recall.
- Preserve lexical-only fallback when ontology or embeddings are unavailable.
- Do not edit prior plan files under `docs/superpowers/plans/`.
- Do not create commits unless the user explicitly requests them.
- Spec: `docs/superpowers/specs/2026-07-17-deterministic-first-basket-resolution-design.md`.

---

## File Structure

**Create**

- `packages/db/src/migrations/009_deterministic_first_form_class.sql` — `form`, `product_class`, category-default implications, processed penalties, search-config knobs.
- `packages/shared/src/intent/queryProfile.ts` — build `QueryProfile` from text + ontology (+ optional amount).
- `packages/shared/src/intent/deterministicRank.ts` — lexicographic candidate ranking from evidence + gate + pack fit.
- `packages/shared/tests/intent/queryProfile.test.ts`
- `packages/shared/tests/intent/deterministicRank.test.ts`
- `services/api/src/services/basket/resolutionDecision.ts` — map ranked hits → `resolved` / `needs_confirmation` / `unresolved`.
- `services/api/tests/services/basket/resolutionDecision.test.ts`
- `services/api/tests/services/basket/herzliyaGolden.test.ts` — golden BBQ cases (unit-level with fixtures).
- `packages/db/tests/fixtures/herzliya-bbq-golden.json` — labeled forbidden/acceptable name rules.

**Modify**

- `packages/shared/src/types/semanticTypes.ts` — `QueryProfile`, `RetrievalEvidence`.
- `packages/shared/src/types/semanticSearch.ts` — first-pass limits, fallback limits, min safe-resolution ratio, substitution confidence floor.
- `packages/shared/src/intent/semanticMatcher.ts` — category-default implied constraints; keep name-agnostic.
- `packages/shared/src/intent/tokenMatcher.ts` — exact/whole-query helpers if needed by evidence.
- `packages/shared/src/intent/index.ts` — exports.
- `packages/shared/test-utils/heRetailOntology.ts` — mirror new form/class seeds for unit tests.
- `packages/db/src/queries/semantic/ontology.ts` — load any new config keys.
- `services/api/src/services/search/types.ts` — attach `RetrievalEvidence` + keep `lexicalScore` separate from fused RRF.
- `services/api/src/services/search/lexicalSql.ts` — exact-name / token-boundary boosts; emit evidence columns.
- `services/api/src/services/search/scoredSearch.ts` — deterministic-first: skip ANN when lexical is strong; preserve lexical scores.
- `services/api/src/services/search/intentRank.ts` — feed deterministic ranker; stop local-first filter when evidence is weak.
- `services/api/src/services/basket/resolveQuery.ts` — use decision module; local stock as tie-break only.
- `services/api/src/services/basket/candidates.ts` — stop comparing RRF fused scores to 0.55 auto-accept.
- `services/api/src/services/basket/resolve.ts` — concurrency 6; share ontology load.
- `services/api/src/services/basket/optimize.ts` — completeness gate before cheapest/multiStore claims.
- `services/api/src/services/basket/types.ts` — resolution status + completeness fields on result.
- `services/api/src/openapi/basket.ts` — document new response fields.
- `packages/shared/src/utils/config.ts` — optional `SUPER_MCP_DETERMINISTIC_FIRST` (default on with basket).
- `README.md` — deterministic-first ops notes.
- `packages/db/tests/fixtures/semantic-benchmark.json` — add BBQ forbidden cases.

---

### Task 1: Ontology Form / Product Class + Search Config

**Files:**
- Create: `packages/db/src/migrations/009_deterministic_first_form_class.sql`
- Modify: `packages/shared/src/types/semanticSearch.ts`
- Modify: `packages/shared/test-utils/heRetailOntology.ts`
- Test: `packages/db/tests/queries/semantic/semanticIndex.test.ts`

**Interfaces:**
- Consumes: existing `semantic_attribute_definition`, `semantic_term`, `semantic_search_config`.
- Produces: DB-defined `form` and `product_class` attributes; config keys `firstPassLexicalLimit`, `embeddingFallbackLimit`, `minSafeResolutionRatio`, `substitutionMinConfidence`, `requireDeterministicForAutoResolve`.

- [ ] **Step 1: Extend `SemanticSearchConfig`**

In `packages/shared/src/types/semanticSearch.ts` add fields and defaults:

```ts
export interface SemanticSearchConfig {
  // existing fields…
  firstPassLexicalLimit: number;
  embeddingFallbackLimit: number;
  minSafeResolutionRatio: number;
  substitutionMinConfidence: number;
  requireDeterministicForAutoResolve: boolean;
}

export const DEFAULT_SEMANTIC_SEARCH_CONFIG: SemanticSearchConfig = {
  // existing…
  firstPassLexicalLimit: 20,
  embeddingFallbackLimit: 15,
  minSafeResolutionRatio: 0.7,
  substitutionMinConfidence: 0.25,
  requireDeterministicForAutoResolve: true,
};
```

Update `parseSemanticSearchConfig` to read the new keys (boolean via existing `b()`, numbers via `n()`).

- [ ] **Step 2: Write migration 009**

Create `packages/db/src/migrations/009_deterministic_first_form_class.sql` that:

1. Inserts attribute definitions:

```sql
INSERT INTO semantic_attribute_definition (
  ontology_version, attribute, constraint_strength, missing_value_behavior,
  enables_nearby_alternative, conflict_policy
) VALUES
  ('he-retail-v1', 'form', 'hard', 'allow', false, 'different_value'),
  ('he-retail-v1', 'product_class', 'hard', 'allow', false, 'different_value')
ON CONFLICT (ontology_version, attribute) DO UPDATE SET
  constraint_strength = EXCLUDED.constraint_strength,
  missing_value_behavior = EXCLUDED.missing_value_behavior,
  enables_nearby_alternative = EXCLUDED.enables_nearby_alternative,
  conflict_policy = EXCLUDED.conflict_policy;
```

2. Seeds `form` / `product_class` / penalty terms (Hebrew surfaces are **data**, not engine code), including at least:

- `form=fresh` surfaces for bare produce concepts already in ontology
- `form=pickled` → `במלח`, `כבוש`, `חמוץ`
- `form=frozen` → `קפוא`, `מוקפא`
- `form=prepared` → `נקניק`, `נקניקיות`, `פסטרמה`
- `form=dessert` → `קרחון`, `גלידה`
- `product_class=beverage` → `ליקר`, `יין` (as class markers where appropriate)
- `product_class=produce` on existing produce concept terms via `implies_attribute` / `implies_value` where the schema allows, or attribute rows on those surfaces

3. Updates `semantic_search_config` JSON for `he-retail-v1` to include the new keys (merge with existing JSON via `||` or full replace of known defaults).

Use `match_mode='token'` / `'phrase'` and priorities consistent with migration 008 patterns.

- [ ] **Step 3: Mirror seeds in test fixture**

Update `packages/shared/test-utils/heRetailOntology.ts` with the same attribute definitions and a minimal subset of form/class/penalty terms so unit tests do not need Postgres.

- [ ] **Step 4: Apply migration and extend DB test**

Run:

```bash
pnpm db:migrate
```

Expected: `009_deterministic_first_form_class.sql` applied (or skipped if already applied).

In `packages/db/tests/queries/semantic/semanticIndex.test.ts`, assert:

```ts
expect(snap.attributes.some((a) => a.attribute === "form" && a.constraintStrength === "hard")).toBe(true);
expect(snap.attributes.some((a) => a.attribute === "product_class")).toBe(true);
expect(snap.searchConfig.firstPassLexicalLimit).toBeGreaterThan(0);
```

Run:

```bash
pnpm --filter @super-mcp/db test
```

Expected: PASS.

- [ ] **Step 5: Commit (skip unless user requested)**

---

### Task 2: QueryProfile Extraction

**Files:**
- Create: `packages/shared/src/intent/queryProfile.ts`
- Modify: `packages/shared/src/types/semanticTypes.ts`
- Modify: `packages/shared/src/intent/semanticMatcher.ts`
- Modify: `packages/shared/src/intent/index.ts`
- Test: `packages/shared/tests/intent/queryProfile.test.ts`

**Interfaces:**
- Consumes: `OntologySnapshot`, `profileFromText`, `extractConstraints`, `normalizeEmbedInput`, `tokenizeNormalized`.
- Produces:

```ts
export interface QueryProfile {
  normalizedText: string;
  coreTerms: string[];
  category: string | null;
  attributes: Record<string, string>;
  requestedAmount: { quantity: number; unit: string } | null;
}

export function buildQueryProfile(
  query: string,
  ontology: OntologySnapshot,
  opts?: { amount?: number | null; unit?: string | null },
): QueryProfile;
```

- [ ] **Step 1: Add types**

In `semanticTypes.ts`:

```ts
export interface QueryProfile {
  normalizedText: string;
  coreTerms: string[];
  category: string | null;
  attributes: Record<string, string>;
  requestedAmount: { quantity: number; unit: string } | null;
}

export interface RetrievalEvidence {
  exactName: boolean;
  exactPhrase: boolean;
  matchedTokenCount: number;
  queryTokenCount: number;
  trigramSimilarity: number | null;
  aliasMatched: boolean;
  vectorDistance: number | null;
  lexicalScore: number | null;
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/shared/tests/intent/queryProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { heRetailOntologyFixture } from "../../test-utils/heRetailOntology.js";
import { buildQueryProfile } from "../../src/intent/queryProfile.js";

describe("buildQueryProfile", () => {
  const ontology = heRetailOntologyFixture();

  it("implies form=fresh for bare produce concept מלפפונים", () => {
    const p = buildQueryProfile("מלפפונים", ontology);
    expect(p.attributes.form).toBe("fresh");
    expect(p.attributes.product_class ?? p.category).toBeTruthy();
  });

  it("does not invent form when query already has pickled cue", () => {
    const p = buildQueryProfile("מלפפונים כבושים", ontology);
    expect(p.attributes.form).toBe("pickled");
  });

  it("keeps cut/species for פרגיות", () => {
    const p = buildQueryProfile("פרגיות", ontology);
    expect(p.attributes.cut).toBe("thighs");
  });
});
```

Run:

```bash
pnpm --filter @super-mcp/shared test -- tests/intent/queryProfile.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `buildQueryProfile`**

```ts
import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import { tokenizeNormalized } from "./tokenMatcher.js";
import { extractConstraints, profileFromText } from "./semanticMatcher.js";
import type { OntologySnapshot, QueryProfile } from "../types/semanticTypes.js";

export function buildQueryProfile(
  query: string,
  ontology: OntologySnapshot,
  opts?: { amount?: number | null; unit?: string | null },
): QueryProfile {
  const normalizedText = normalizeEmbedInput(query);
  const profile = profileFromText(query, ontology);
  const constraints = extractConstraints(query, ontology);
  const attributes = { ...profile.attributes };

  // Apply implied category defaults from ontology terms whose kind/attribute
  // encode defaults (e.g. concept produce → form fresh) ONLY when unset.
  for (const c of constraints) {
    if (attributes[c.attribute] == null) attributes[c.attribute] = c.value;
  }
  applyCategoryDefaults(attributes, profile.concepts, ontology);

  const coreTerms = tokenizeNormalized(normalizedText, ontology.locale).filter(
    (t) => !ontology.terms.some((term) => term.kind === "stopword" && normalizeEmbedInput(term.term) === t),
  );

  const requestedAmount =
    opts?.amount != null && opts.unit?.trim()
      ? { quantity: opts.amount, unit: opts.unit.trim() }
      : null;

  return {
    normalizedText,
    coreTerms,
    category: attributes.product_class ?? null,
    attributes,
    requestedAmount,
  };
}

function applyCategoryDefaults(
  attributes: Record<string, string>,
  concepts: string[],
  ontology: OntologySnapshot,
): void {
  // Data-driven: look for ontology terms with kind=concept that imply form/product_class
  // when those attributes are still unset. No Hebrew hardcoding here.
  for (const term of ontology.terms) {
    if (term.kind !== "concept" || !term.value) continue;
    if (!concepts.includes(term.value)) continue;
    if (term.impliesAttribute && term.impliesValue && attributes[term.impliesAttribute] == null) {
      attributes[term.impliesAttribute] = term.impliesValue;
    }
  }
}
```

Ensure migration 009 / fixture seeds produce concepts that `implies_attribute='form'`, `implies_value='fresh'` for produce concepts (`מלפפון`, etc.).

- [ ] **Step 4: Export and pass tests**

Export from `intent/index.ts`. Re-run shared test file — Expected: PASS.

- [ ] **Step 5: Commit (skip unless user requested)**

---

### Task 3: Lexical Evidence + Exact-Name Boost

**Files:**
- Modify: `services/api/src/services/search/types.ts`
- Modify: `services/api/src/services/search/lexicalSql.ts`
- Modify: `services/api/src/services/search/scoredSearch.ts`
- Test: `services/api/tests/services/search/lexicalEvidence.test.ts` (pure helpers) and/or extend existing search tests

**Interfaces:**
- Consumes: `RetrievalEvidence` from shared.
- Produces: `SearchProductHit.evidence?: RetrievalEvidence` and `SearchProductHit.lexicalScore?: number` that survive fusion.

- [ ] **Step 1: Extend hit types**

In `services/api/src/services/search/types.ts`:

```ts
import type { RetrievalEvidence } from "@super-mcp/shared";

export interface SearchProductHit extends ProductSummary {
  score: number;
  matchedVia: "product" | "listing" | "gtin" | "vector" | "alias";
  hasPrice: boolean;
  hasLocalPrice: boolean;
  vectorDistance?: number | null;
  lexicalScore?: number | null;
  evidence?: RetrievalEvidence;
}
```

- [ ] **Step 2: Boost exact normalized equality in SQL**

In `buildLexicalRankedCte`, change the GREATEST name CASE to prefer exact equality before prefix/contains:

```sql
CASE
  WHEN $4::text IS NOT NULL AND p.gtin = $4 THEN 1.0
  WHEN $1 <> '' AND lower(p.name) = lower($1) THEN 1.0
  WHEN $1 <> '' AND p.name ILIKE $6 || '%' ESCAPE '\\' THEN 0.95
  WHEN $1 <> '' AND (
    p.name ILIKE $6 || ' %' ESCAPE '\\'
    OR p.name ILIKE '% ' || $6 ESCAPE '\\'
    OR p.name ILIKE '% ' || $6 || ' %' ESCAPE '\\'
  ) THEN 0.9
  WHEN $1 <> '' AND p.name ILIKE '%' || $6 || '%' ESCAPE '\\' THEN 0.78
  ELSE 0
END
```

Keep existing trigram/listing/alias arms. Document that substring-only hits stay at 0.78 and lose to boundary/exact.

- [ ] **Step 3: Populate evidence when mapping rows**

In `scoredSearch.ts` `mapSearchHitRow` (or equivalent), set:

```ts
lexicalScore: Number(row.score),
evidence: {
  exactName: Number(row.score) >= 0.999,
  exactPhrase: Number(row.score) >= 0.9,
  matchedTokenCount: 0, // filled in resolve/rank from QueryProfile if needed
  queryTokenCount: 0,
  trigramSimilarity: null,
  aliasMatched: row.matched_via === "alias",
  vectorDistance: null,
  lexicalScore: Number(row.score),
},
```

After token matching is available in the API ranker, update `matchedTokenCount` / `queryTokenCount` from `QueryProfile.coreTerms` vs product name tokens.

- [ ] **Step 4: Preserve lexicalScore through RRF**

In `rankFusion.ts`, when ensuring a candidate from lexical list, copy `lexicalScore` and `evidence`. Do **not** overwrite `lexicalScore` with `fusedScore`. Keep `score` as fused for ranking fusion only; basket will prefer `lexicalScore` + evidence.

```ts
c.lexicalScore = hit.lexicalScore ?? c.lexicalScore ?? null;
if (hit.evidence) c.evidence = { ...hit.evidence, ...c.evidence, lexicalScore: hit.lexicalScore ?? hit.evidence.lexicalScore };
```

Add a unit test in `services/api/tests/services/search/rankFusion.test.ts` asserting fused hits retain `lexicalScore: 0.95` when lexical input had 0.95.

- [ ] **Step 5: Run API search tests**

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/search
```

Expected: PASS.

- [ ] **Step 6: Commit (skip unless user requested)**

---

### Task 4: Compatibility Gate for Form / Class + Deterministic Ranker

**Files:**
- Create: `packages/shared/src/intent/deterministicRank.ts`
- Modify: `packages/shared/src/intent/semanticMatcher.ts` (only if category defaults need extractConstraints help)
- Test: `packages/shared/tests/intent/deterministicRank.test.ts`
- Modify: `packages/shared/tests/intent/semanticMatcher.test.ts` (add produce/form cases)

**Interfaces:**
- Consumes: `QueryProfile`, `SemanticProfile`, `gateAgainstConstraints`, `RetrievalEvidence`.
- Produces:

```ts
export interface DeterministicCandidate {
  id: string;
  name: string;
  profile: SemanticProfile;
  evidence: RetrievalEvidence;
  hasLocalPrice: boolean;
  hasPrice: boolean;
  packExcess: number; // +inf if N/A
  gate: SemanticGateResult;
}

export function rankDeterministicCandidates(
  query: QueryProfile,
  candidates: DeterministicCandidate[],
): DeterministicCandidate[];
```

Compare order (ascending better):

1. `gate.allowed` false → drop
2. `gate.tier` ascending
3. `evidence.exactName` / `exactPhrase` descending
4. form/class agreement (attribute equality count)
5. core-token coverage descending
6. packExcess ascending
7. `evidence.lexicalScore` descending
8. lower `vectorDistance` if present
9. `hasLocalPrice` descending
10. name length ascending

- [ ] **Step 1: Failing tests for Herzliya collisions**

```ts
it("rejects pickled cucumber for fresh מלפפונים query", () => {
  const ontology = heRetailOntologyFixture();
  const q = buildQueryProfile("מלפפונים", ontology);
  const fresh = profileFromText("מלפפון", ontology);
  const pickled = profileFromText("מלפפונים במלח טעם ביתי", ontology);
  // ensure pickled has form=pickled from ontology terms
  const ranked = rankDeterministicCandidates(q, [
    cand("p", "מלפפונים במלח טעם ביתי", pickled, { lexicalScore: 0.78, exactName: false, exactPhrase: false }),
    cand("f", "מלפפון", fresh, { lexicalScore: 0.9, exactName: false, exactPhrase: true }),
  ]);
  expect(ranked[0]?.id).toBe("f");
  expect(ranked.every((c) => c.id !== "p" || c.gate.allowed)).toBe(true);
  // pickled must be disallowed OR ranked below fresh with gate conflict
});

it("does not prefer local sausage over better thigh name when scores are tiny", () => {
  // local prepared/sausage profile vs global thighs exact-ish
});
```

Wire `gateAgainstConstraints` using constraints derived from `QueryProfile.attributes` (explicit hard constraints). Prefer extending `extractConstraints` / adding `constraintsFromQueryProfile(profile, ontology)`.

- [ ] **Step 2: Implement ranker + constraints-from-profile**

```ts
export function constraintsFromQueryProfile(
  query: QueryProfile,
  ontology: OntologySnapshot,
): SemanticConstraint[] {
  return Object.entries(query.attributes).map(([attribute, value]) => {
    const def = ontology.attributes.find((a) => a.attribute === attribute);
    return {
      attribute,
      value,
      strength: def?.constraintStrength ?? "hard",
      source: "explicit" as const,
    };
  });
}
```

For each candidate, `gateAgainstConstraints(profile, constraints, ontology, { queryText: query.normalizedText })`.

Drop `!gate.allowed`. Sort with the lexicographic keys above. **Local price is step 9**, never step 1.

- [ ] **Step 3: Pass shared tests**

```bash
pnpm --filter @super-mcp/shared test
```

Expected: PASS.

- [ ] **Step 4: Commit (skip unless user requested)**

---

### Task 5: Resolution Decision (No RRF Auto-Accept)

**Files:**
- Create: `services/api/src/services/basket/resolutionDecision.ts`
- Modify: `services/api/src/services/basket/candidates.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Test: `services/api/tests/services/basket/resolutionDecision.test.ts`

**Interfaces:**
- Consumes: ranked `DeterministicCandidate[]` / `SearchProductHit` with evidence.
- Produces:

```ts
export type ResolutionStatus = "resolved" | "needs_confirmation" | "unresolved";

export interface ResolutionDecision {
  status: ResolutionStatus;
  productId: string | null;
  name: string | null;
  confidenceLabel: "high" | "medium" | null;
  confidence: number | null; // lexicalScore of chosen, for API compat
  lowConfidence: boolean;
  autoPrice: boolean;
}
```

Auto-resolve only when:

- `requireDeterministicForAutoResolve` ⇒ `evidence.exactName || evidence.exactPhrase || (lexicalScore >= 0.9)`
- `gate.tier <= 2`
- margin: next candidate’s lexicalScore ≤ chosen − `autoAcceptGap` **or** next fails form agreement while chosen matches
- never auto-resolve from `vectorDistance` alone

- [ ] **Step 1: Write failing tests**

```ts
it("does not auto-resolve RRF-scale 0.016 scores", () => {
  const d = decideResolution([hit({ lexicalScore: 0.016, exactPhrase: false, exactName: false })], config);
  expect(d.status).toBe("needs_confirmation");
  expect(d.autoPrice).toBe(false);
});

it("auto-resolves exact phrase lexical 0.95 with margin", () => {
  const d = decideResolution(
    [
      hit({ lexicalScore: 0.95, exactPhrase: true, exactName: false }),
      hit({ lexicalScore: 0.7, exactPhrase: false }),
    ],
    config,
  );
  expect(d.status).toBe("resolved");
  expect(d.autoPrice).toBe(true);
});
```

- [ ] **Step 2: Implement `decideResolution`**

Keep `pickFromCandidates` for pack-peer narrowing if needed, but **stop** using fused `score` against `autoAcceptScore`. Prefer `decideResolution` as the authority for `autoPrice`.

- [ ] **Step 3: Wire types on `ResolvedItem`**

Add optional `resolutionStatus: ResolutionStatus` (or map `resolvedBy` + `lowConfidence` consistently: `resolved` ⇒ `productId` set + `lowConfidence=false`; `needs_confirmation` ⇒ `productId=null`, candidates filled, `lowConfidence=true`).

Spec discrete statuses; keep MCP/OpenAPI backward compatible by retaining `lowConfidence` / `productId` null.

- [ ] **Step 4: Pass tests**

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/resolutionDecision.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit (skip unless user requested)**

---

### Task 6: Wire resolveQuery + Embedding Fallback Only When Weak

**Files:**
- Modify: `services/api/src/services/basket/resolveQuery.ts`
- Modify: `services/api/src/services/search/scoredSearch.ts`
- Modify: `services/api/src/services/search/intentRank.ts`
- Test: `services/api/tests/services/search/fallback.test.ts`
- Test: `services/api/tests/services/basket/herzliyaGolden.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `resolveQueryItem` behavior matching the cascade.

- [ ] **Step 1: Change search cascade**

In `searchProductsScored`:

1. Always run lexical with `firstPassLexicalLimit` (from ontology config / defaults).
2. If top lexical hit has `lexicalScore >= 0.9` OR exact name/phrase evidence → **return lexical-only** (skip embed/ANN). Log `fallbackReason: null`, `path: "deterministic_only"`.
3. Else run query embed + ANN with `embeddingFallbackLimit`, fuse, but keep each hit’s `lexicalScore`/`evidence`.
4. On embed failure → lexical-only (existing).

- [ ] **Step 2: Rewrite resolveQuery ranking**

Replace the final sort that starts with `hasLocalPrice` with:

1. Build `QueryProfile`.
2. Load profiles for hits.
3. Map to `DeterministicCandidate` (compute `packExcess` as today).
4. `rankDeterministicCandidates`.
5. `decideResolution`.
6. Substitution only if `status==="resolved"` AND chosen ≠ lexicalPrimary AND `confidence >= substitutionMinConfidence` AND gate allows equivalence (tier ≤ 2). Otherwise `substitution = null`.

Remove / bypass `rankHitsForIntent` localExact filter for the production path once deterministic ranker is used (keep `rankHitsForIntent` for tests or thin-wrap it to call the new ranker).

- [ ] **Step 3: Golden unit tests (fixture hits)**

Create `services/api/tests/services/basket/herzliyaGolden.test.ts` that builds synthetic `SearchProductHit[]` for each failure mode and asserts `resolveQueryItem` (with mocked `searchProductsScored`) never returns forbidden names as `name` when `autoPrice` is true, and when confirming, top candidate is not in the forbidden set if a safe candidate exists in the mock pool.

Use Hebrew fixtures from `packages/db/tests/fixtures/herzliya-bbq-golden.json`:

```json
{
  "cases": [
    {
      "query": "פרגיות",
      "amount": 1.75,
      "unit": "kg",
      "forbiddenNameSubstrings": ["נקניק", "פסטרמה"],
      "acceptableNameSubstrings": ["פרגיות", "ירכיים"]
    },
    {
      "query": "מלפפונים",
      "forbiddenNameSubstrings": ["במלח", "כבוש", "חמוץ"],
      "acceptableNameSubstrings": ["מלפפון"]
    },
    {
      "query": "לימונים",
      "forbiddenNameSubstrings": ["ליקר"],
      "acceptableNameSubstrings": ["לימון"]
    },
    {
      "query": "קרח",
      "forbiddenNameSubstrings": ["קרחון", "גלידה"],
      "acceptableNameSubstrings": ["קרח"]
    }
  ]
}
```

- [ ] **Step 4: Run API basket + search tests**

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket tests/services/search
```

Expected: PASS.

- [ ] **Step 5: Commit (skip unless user requested)**

---

### Task 7: Basket Completeness Gate + Performance

**Files:**
- Modify: `services/api/src/services/basket/resolve.ts`
- Modify: `services/api/src/services/basket/optimize.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/src/openapi/basket.ts`
- Modify: `services/api/src/services/search/ontology.ts` (optional warm helper)
- Modify: `services/api/src/index.ts` (warm embedder on listen)
- Test: `services/api/tests/services/basket/optimizeCompleteness.test.ts`

**Interfaces:**
- Produces on `BasketOptimizeResult`:

```ts
completeness: {
  requestedLines: number;
  resolvedLines: number;
  needsConfirmationLines: number;
  unresolvedLines: number;
  safeResolutionRatio: number;
  totalsArePartial: boolean;
};
```

When `safeResolutionRatio < minSafeResolutionRatio`: set `cheapest = null`, `multiStore = null` (or keep multiStore but mark partial), still return `items` + `stores` priced only for resolved lines, and set `totalsArePartial: true`. Never claim a full-list cheapest total.

- [ ] **Step 1: Completeness test**

```ts
it("does not return cheapest when fewer than 70% lines resolve", async () => {
  // mock resolveItems → 1/18 productIds
  const result = await optimizeBasket(...);
  expect(result.cheapest).toBeNull();
  expect(result.completeness.totalsArePartial).toBe(true);
});
```

- [ ] **Step 2: Implement gate in `optimize.ts`**

After building `itemStatuses`, compute ratios. If below threshold, return stores/lines for debugging but null out `cheapest` / document partial in `reason` if any recommendation remains.

- [ ] **Step 3: Raise resolve concurrency**

In `resolve.ts`:

```ts
return mapPool(items, 6, (item, index) => resolveOneItem(index, item, location));
```

Optionally pass a shared `ontology` promise into `resolveQueryItem` to avoid N cache stampede (read-through cache already exists — ensure singleflight or preload `getActiveOntology()` once in `resolveItems`).

- [ ] **Step 4: Warm embedder on API boot**

In `services/api/src/index.ts` after listen (or before), fire-and-forget:

```ts
void import("./services/search/queryEmbedding.js").then((m) =>
  m.getQueryEmbedding("warmup").catch(() => undefined),
);
```

Or export `warmQueryEmbedder()` that calls `embedText` with hasher/transformers per env.

- [ ] **Step 5: OpenAPI + README**

Document `completeness` and deterministic-first flags. Note warm vs cold latency targets.

- [ ] **Step 6: Run API tests + typecheck**

```bash
pnpm --filter @super-mcp/api exec vitest run
pnpm -r run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit (skip unless user requested)**

---

### Task 8: Benchmark Fixture + Manual Herzliya Re-Spin Checklist

**Files:**
- Create: `packages/db/tests/fixtures/herzliya-bbq-golden.json`
- Modify: `packages/db/tests/fixtures/semantic-benchmark.json`
- Modify: `packages/db/src/scripts/benchmarkSemantic.ts` (load BBQ cases into activation / report forbidden hits)
- Modify: `README.md`

**Interfaces:**
- Produces: benchmark reports unsafe rate including BBQ forbidden substrings; ops checklist for re-spin.

- [ ] **Step 1: Add golden JSON** (full 18-line list from the spin, with forbidden/acceptable substrings).

- [ ] **Step 2: Extend benchmark to print `forbiddenHitRate` for those cases.**

- [ ] **Step 3: Document re-spin commands**

```bash
pnpm db:migrate
SUPER_MCP_EMBED_BACKEND=hasher pnpm db:benchmark-semantic
# API warm:
pnpm --filter @super-mcp/api dev
# then POST /v1/basket/optimize with Herzliya city + items
```

Success checklist (manual):

- zero forbidden auto-picks;
- `completeness.safeResolutionRatio >= 0.7` or honest partial totals;
- warm wall clock under 8s for 18 lines.

- [ ] **Step 4: Final verification**

```bash
rm -rf packages/*/dist services/*/dist
pnpm build
pnpm test
pnpm -r run typecheck
pnpm db:migrate
```

Expected: all green.

- [ ] **Step 5: Commit (skip unless user requested)**

---

## Self-Review vs Spec

| Spec section | Task |
|--------------|------|
| Query interpretation / QueryProfile | Task 2 |
| Deterministic recall + evidence | Task 3 |
| Compatibility gate (form/class) | Tasks 1, 4 |
| Embedding fallback only when weak | Task 6 |
| Lexicographic ranking; local as tie-break | Task 4, 6 |
| Discrete confidence / no RRF auto-accept | Task 5 |
| Basket completeness / no misleading total | Task 7 |
| Performance (concurrency, warm, limits) | Tasks 1, 6, 7 |
| Observability path field | Task 6 (`deterministic_only`) |
| Golden Herzliya tests | Tasks 6, 8 |
| Rollout shadow → cutover | Task 6 flag + Task 8 checklist |
| Vector generation mismatch | Covered by existing queryCache validation; Task 6 skips ANN when mismatch/unavailable |

No TBD placeholders. Commit steps are optional per Global Constraints.
