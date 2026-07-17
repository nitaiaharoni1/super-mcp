# Generic Semantic Retrieval V2

## Goal

Make product resolution genuinely semantic and market-independent without allowing embeddings to silently violate explicit shopper constraints.

Product embeddings are computed only when product text changes. Normalized query embeddings are computed once per distinct query and cached by model version.

## Problem

The current implementation is only partly generic:

- Runtime policy still names attributes such as `kosher`, `cut`, and `species`.
- Ontology terms use substring matching, which can produce false positives.
- Vector recall depends on lexical anchors, so unknown wording may never reach semantic search.
- Search thresholds and confidence cutoffs are hardcoded.
- Persisted product profiles omit penalties and normalized concept terms.
- The fallback TypeScript ontology can drift from the database ontology.

Embeddings alone are not sufficient. They are useful for candidate recall and ranking, but cannot safely decide that fresh and frozen, or chicken and turkey, are interchangeable.

## Architecture

Separate the system into four independent stages:

1. **Recall:** retrieve candidates using cached query embeddings, precomputed product embeddings, and lexical search as parallel signals.
2. **Profile:** load complete, precomputed product semantic profiles.
3. **Policy:** evaluate only explicit query constraints using generic attribute definitions.
4. **Commerce ranking:** combine policy tier, local availability, price, pack fit, and calibrated retrieval scores.

No stage contains Hebrew terms or product-category branches. Market knowledge is versioned data.

## Query and Product Embeddings

- Keep one product vector per `(product_id, model_version)`.
- Refresh a product vector only when its normalized embedding input hash changes.
- Add a query embedding cache keyed by `(normalized_query_hash, model_version)`.
- Embed a query on cache miss, store it, and reuse it for later requests.
- Query the pgvector product index directly with the query vector.
- Run lexical search independently and merge candidates using calibrated rank fusion.
- Never require a lexical anchor before semantic retrieval.
- Never compare vectors from different model versions or dimensions.

The embedding model provides recall and similarity only. It does not override constraints.

## Generic Constraint Model

Add versioned attribute definitions with:

- attribute key;
- default constraint strength;
- behavior when a candidate value is missing;
- whether the attribute can enable nearby alternatives;
- conflict policy;
- optional relaxation group.

Ontology terms reference attribute definitions and declare a match mode:

- `token`: one normalized token;
- `phrase`: contiguous normalized tokens;
- `exact`: the complete normalized field;
- `alias`: query expansion only.

Regex is not a normal matching mode. Exceptional regex support, if ever needed, must be explicitly enabled and separately tested.

The matcher uses locale-aware tokenization and longest non-overlapping phrase matching. It records the matched surface term and source. It does not branch on attribute names.

Only constraints explicitly detected in the shopper query can hard-reject a candidate. Inferred concepts may improve ranking but cannot create a hard rejection.

## Complete Semantic Profiles

Persist the same `SemanticProfile` shape used at runtime:

- attributes;
- concepts;
- penalties;
- normalized concept terms;
- ontology version;
- input hash;
- profiling timestamp.

Both query and product text use the same normalization and matching pipeline. Runtime ranking does not reconstruct missing profile fields from raw names.

The database ontology is the single source of truth. Tests use synthetic snapshots or load seeded database data. Remove the hand-maintained Hebrew fallback fixture after rollout; lexical-only fallback remains available if ontology loading fails.

## Ranking and Configuration

Move retrieval and confidence settings into versioned search configuration:

- vector candidate limit and distance cutoff;
- lexical trigram threshold;
- reciprocal-rank-fusion weights;
- auto-accept score and score-gap threshold;
- nearby-alternative enablement;
- minimum vector/profile coverage.

Commerce policy remains explicit and generic:

1. locally available candidates satisfying all hard constraints;
2. locally available candidates using configured safe relaxations;
3. nearby alternatives only when enabled and tiers 1–2 are empty;
4. global or lexical fallback when local semantic candidates are absent.

Every substitution reports the original candidate, selected candidate, changed attributes, reason, and confidence.

## Failure Handling

- Query embedding failure falls back to lexical retrieval and records a structured event.
- Missing or stale product vectors do not fail a request; affected products remain lexical candidates.
- Missing ontology data disables constraint gating rather than using a stale code fixture.
- Model or dimension mismatch disables vector retrieval for that request and emits an error metric.
- Ingestion keeps committed catalog data if semantic indexing fails and leaves dirty work resumable.

## Evaluation and Rollout

Build a labeled benchmark spanning meat, dairy, produce, pantry, brands, pack sizes, dietary constraints, unknown wording, and negative substitutions.

Measure:

- semantic and lexical recall at K;
- top-1 local resolution;
- missing basket lines;
- unsafe substitution rate;
- query-embedding cache hit rate;
- candidate and total latency;
- vector/profile coverage and dirty age;
- disagreement with the current resolver.

Roll out in stages:

1. stabilize the current test/repository state;
2. add query embeddings and full profiles behind a shadow flag;
3. compare candidate sets and policy outcomes;
4. enable semantic recall while retaining old ranking;
5. enable generic policy/ranking after quality thresholds pass;
6. remove legacy substring matching, hardcoded attribute branches, and the duplicate fixture.

## Repository Integrity Prerequisite

Before relying on benchmark results:

- fix the broken relative import in `services/api/tests/services/basket.intent.test.ts`;
- consolidate duplicate `src/**.test.ts` and `tests/**` suites;
- ensure the split module directories and migrations are tracked;
- rebuild from a clean output directory so stale `dist/` files cannot mask missing exports;
- run the root build, tests, and typechecks successfully.

## Non-goals

- No LLM-only product resolver.
- No synchronous re-embedding of the product catalog during API requests.
- No admin UI for ontology editing.
- No full catalog taxonomy cleanup in this phase.
