# Deterministic-First Basket Resolution

**Status:** Approved  
**Date:** 2026-07-17

## Goal

Resolve grocery basket lines quickly and safely. A wrong product is worse than an unresolved line.

The resolver must:

- prefer exact, compatible products over semantically related products;
- never let local stock or price override product compatibility;
- use embeddings only to improve recall when deterministic search is weak;
- return `needs_confirmation` instead of inventing a substitution;
- resolve a typical 18-line warm basket in under 8 seconds.

## Evidence from the Herzliya Trial

The 18-line BBQ basket exposed these failures:

- `פרגיות` selected chicken sausages instead of chicken thighs;
- `מלפפונים` selected pickled cucumbers;
- `לימונים` selected limoncello;
- `קרח` selected a popsicle;
- `בצלים` selected frozen sliced onions;
- only one line auto-resolved;
- the quoted store total represented an incomplete basket;
- a cold run took minutes.

Two implementation details amplified the problem:

1. The final basket sort prioritizes `hasLocalPrice` before relevance.
2. Reciprocal-rank-fusion scores near `0.01–0.03` are compared with an auto-accept threshold of `0.55`.

## Chosen Approach

Use a deterministic-first cascade:

1. Parse query constraints and product form.
2. Run cheap lexical retrieval.
3. Accept only strong deterministic matches.
4. Run embedding recall only for unresolved or ambiguous lines.
5. Apply the same deterministic compatibility gates to embedding candidates.
6. Optimize stores only after enough lines are safely resolved.

Embeddings generate candidates. They do not decide compatibility or substitutions.

## Architecture

### 1. Query Interpretation

Convert each query into a generic `QueryProfile`:

```ts
interface QueryProfile {
  normalizedText: string;
  coreTerms: string[];
  category: string | null;
  attributes: Record<string, string>;
  requestedAmount: {
    quantity: number;
    unit: string;
  } | null;
}
```

Attributes remain database-defined. Examples include:

- `form=fresh|frozen|pickled|prepared`;
- `product_class=produce|meat|beverage|pantry`;
- `species=chicken|turkey|beef`;
- `cut=thighs|breast|entrecote`;
- `brand=...`.

Category defaults may imply attributes. A bare produce query such as `מלפפונים` may imply `form=fresh`. This implication is stored in ontology data, not Hebrew-specific TypeScript branches.

### 2. Deterministic Recall

Retrieve candidates using:

1. exact normalized name;
2. exact phrase;
3. token-boundary match;
4. ontology alias;
5. prefix and trigram match.

Each retrieval result carries its raw evidence:

```ts
interface RetrievalEvidence {
  exactName: boolean;
  exactPhrase: boolean;
  matchedTokenCount: number;
  queryTokenCount: number;
  trigramSimilarity: number | null;
  aliasMatched: boolean;
  vectorDistance: number | null;
}
```

Compound names do not receive exact-match credit merely because they contain a token. For example, `קרחון` is not an exact match for `קרח`.

### 3. Compatibility Gate

Before ranking, reject candidates with explicit or inferred hard conflicts.

Examples:

- bare fresh produce rejects pickled or frozen forms;
- `פרגיות` rejects sausage and deli-meat forms;
- `קרח` rejects ice cream and popsicles;
- `לימון` rejects liquor and cleaning products.

The gate is generic: it compares query and product profiles using database attribute definitions. It does not branch on product names.

Embedding-only candidates must pass the same gate.

### 4. Embedding Fallback

Skip embeddings when deterministic recall produces:

- an exact compatible match; or
- a compatible top candidate with sufficient lexical confidence and margin.

Use cached query embeddings only when deterministic recall is weak. Direct ANN may add candidates up to a small configurable limit.

Product and query vectors must use the same model, backend, dimensions, and generation identifier. A generation mismatch disables vector recall for that request.

### 5. Ranking

Rank compatible candidates lexicographically by decision class, not by one blended score:

1. compatibility tier;
2. exact-name or exact-phrase evidence;
3. category and form agreement;
4. core-token coverage;
5. brand agreement;
6. pack and amount fit;
7. lexical relevance;
8. semantic relevance;
9. local availability;
10. price.

Local availability is a tie-breaker among sufficiently equivalent candidates. It cannot promote an incompatible or materially weaker product.

### 6. Confidence

Do not reuse RRF scores as probabilities.

Return a discrete decision:

```ts
type ResolutionDecision =
  | { status: "resolved"; productId: string; confidence: "high" | "medium" }
  | { status: "needs_confirmation"; candidates: Candidate[] }
  | { status: "unresolved"; candidates: Candidate[] };
```

Automatic resolution requires deterministic evidence:

- no hard conflicts;
- exact or strong lexical support;
- adequate margin over the next compatible candidate;
- acceptable pack fit when amount is requested.

Embedding similarity alone cannot auto-resolve a line.

Substitution metadata is emitted only for safely equivalent products. Low-confidence alternatives are candidates, not substitutions.

### 7. Basket and Pricing Flow

Resolve all lines first. Then:

- if the safe-resolution ratio is below a configured threshold, return the unresolved lines and skip cheapest-store claims;
- otherwise, price resolved lines and report basket completeness prominently;
- never present a partial total as the total for the original shopping list.

The response includes:

- requested line count;
- resolved line count;
- confirmation-required line count;
- unresolved line count;
- priced completeness by quantity and by line;
- totals labeled as full or partial.

## Performance Design

### Basket-Level Shared Work

- Load ontology and search configuration once per basket.
- Normalize and parse all queries in one pass.
- Batch-load semantic profiles for all candidate IDs.
- Batch lexical queries where practical.
- Batch query-embedding cache reads.

### Bounded Parallelism

Resolve independent lines with configurable concurrency, initially 6. Database and embedding work retain separate limits.

### Adaptive Candidate Limits

- First pass: 15–20 lexical candidates.
- Expand only unresolved lines.
- Embedding fallback: 10–20 ANN candidates.
- Load profiles only for the final union of candidates.

### Embedder Lifecycle

- Warm the configured embedder during API startup.
- Keep query embeddings cached by normalized query and generation.
- Disable vector fallback if the model generation is unavailable or mismatched.

### Latency Targets

- exact deterministic line: p95 under 150 ms;
- warm fallback line: p95 under 750 ms;
- warm 18-line basket: p95 under 8 seconds;
- cold 18-line basket: p95 under 20 seconds.

## Stability and Failure Behavior

- Ontology unavailable: lexical-only retrieval with conservative confirmation.
- Embedding unavailable: deterministic path continues normally.
- Profile coverage low: no hard decision based on missing profile data.
- Database timeout: return a structured partial failure, not a wrong product.
- Model mismatch: disable vector recall and emit a structured health event.
- Insufficient safe resolution: do not calculate a misleading “cheapest basket.”

## Observability

Emit one structured event per basket and compact events per unresolved line:

- deterministic-only versus embedding-fallback count;
- exact-match rate;
- auto-resolution rate;
- confirmation and unresolved rates;
- unsafe candidate rejection counts by attribute;
- vector generation mismatch;
- lexical, vector, profile, and pricing latency;
- basket completeness;
- substitution rate.

Raw query text remains disabled by default.

## Testing

### Golden Herzliya Cases

Add the BBQ list as a regression fixture. At minimum:

- `פרגיות` must not select sausage or deli meat;
- `מלפפונים` must not select pickled cucumber;
- `עגבניות` must prefer plain fresh tomatoes;
- `בצלים` must not select frozen sliced onions;
- `לימונים` must not select liquor;
- `קרח` must not select popsicles;
- `טייסטרס צ׳ויס` must preserve brand intent.

### Required Test Layers

- unit tests for query profile extraction and compatibility;
- deterministic ranking tests;
- vector-generation mismatch tests;
- basket completeness and partial-total tests;
- latency benchmark with warm and cold paths;
- shadow evaluation against the existing resolver.

## Rollout

1. Add deterministic evidence and compatibility gates in shadow mode.
2. Measure disagreement and unsafe rejection on labeled baskets.
3. Switch automatic resolution to deterministic decisions.
4. Enable embedding fallback only for unresolved lines.
5. Enable store optimization only after safe completeness gates pass.
6. Remove the old blended RRF auto-accept behavior.

## Success Criteria

- zero forbidden picks in the Herzliya golden fixture;
- at least 70% of common basket lines resolve safely;
- unresolved lines expose sensible candidates;
- no partial total is presented as a complete basket;
- warm 18-line basket p95 below 8 seconds;
- embeddings can be disabled without breaking correct deterministic resolution.
