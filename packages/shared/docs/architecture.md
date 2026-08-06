# Architecture

## Overview

A pure domain library with no I/O, organized by concern rather than by consumer. It is the dedup floor of the monorepo: anything two packages both need lives here.

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `src/types/` | The `SourceAdapter` contract every ingestion adapter implements, `GeoPoint`, `AppError`, and the semantic-search types |
| `src/intent/` | Query understanding: Hebrew morphology, product aliases, the class taxonomy, phrase evidence, deterministic ranking, and the semantic matcher |
| `src/utils/` | Units, promo math, chain-name lookup, city and neighborhood tables, store identity, text scrubbing, concurrency, and `config.ts` |
| `src/embeddings/` | The local transformers.js embedder and vector helpers |
| `src/fulfillment/` | Delivery-terms and coverage types shared by ingestion and the API |
| `test-utils/` | Fixtures exported to other packages as `@super-mcp/shared/test-utils`; served as raw TypeScript, not through `dist/` |

## Data Flow

- Nothing flows through this package at runtime. Consumers import functions and call them; there is no state, no connection, and no request lifecycle.
- Environment reading is the one exception, and it is centralized: every `SUPER_MCP_*` variable is resolved in `src/utils/config.ts`, so a flag has one definition rather than a scattered set of `process.env` reads.

## Key Patterns

- No I/O, enforced by convention: no HTTP, no filesystem, no database. A helper that needs any of those belongs in `@super-mcp/db` or the calling service.
- `src/intent/` encodes the deterministic half of basket resolution — the token, phrase, and class rules that run before any embedding is considered. Keeping it here is what lets the ingestion classifier and the API resolver agree.
- Hebrew is a first-class input, not an encoding detail: morphology, aliases, and chain-name normalization all live in this package rather than in each consumer.
- Imports carry the `.js` extension on `.ts` sources (ESM with NodeNext resolution).

## Dependencies Between Modules

- Depends on no other workspace package. Everything else depends on it, so a cycle here would break the build order.
- Exposed through three entry points: `.` (main), `./analytics` (event definitions shared by API and web), and `./test-utils`.
- Before adding a helper anywhere in the monorepo, check the canonical-module table in root `docs/folder-conventions.md` — `mapPool`, `scrubString`, `lookupChainNames`, `resolveEmbedModel`, `utils/units`, `utils/promo`, `GeoPoint`.
