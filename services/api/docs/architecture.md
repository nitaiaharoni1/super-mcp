# Architecture

## Overview

A layered Fastify service that exposes the same domain twice: a REST surface under `/v1/**` and a remote MCP server (Streamable HTTP) at `/mcp`, with `/mcp/online` kept as a compatibility alias. Routes validate, services decide, `@super-mcp/db` persists.

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `src/lib/` | API-only glue that does not belong to a domain: haversine SQL (`geo.ts`), error shapes, feature-flag re-exports, store-location resolution |
| `src/openapi/` | Fragment builders that assemble the served OpenAPI document; not hand-written spec |
| `src/mcp/tools/shared/` | Cross-tool argument handling (location parsing, product resolution, result envelopes) that keeps the tool modules thin |
| `src/scripts/` | `tsx` entry points, not part of the served build: canaries, the accuracy harness, benchmarks |

## Data Flow

- HTTP request → `auth.ts` (Bearer key resolution, role, anonymous IP buckets, rate limit) → route module → domain service → `@super-mcp/db` → response.
- MCP request → `mcp/server.ts` → `mcp/tools/register.ts` → a tool module under `mcp/tools/<domain>/` → the same domain services the REST routes call. Tools are a second front door, never a second implementation.
- Basket resolution is the deep path: `services/basket/resolve.ts` gates deterministically (exact name, phrase evidence, product class) and only reaches for embeddings via `services/search/` when lexical recall is weak.
- Analytics is fire-and-forget through `src/analytics/`; a PostHog failure must never affect the response.

## Key Patterns

- Deterministic-first, ambiguity-honest: a line that cannot be resolved with confidence returns `needs_confirmation` instead of a guess, because a wrong product is worse than an unresolved one.
- Long-running basket work is resumable, not stateful: `services/basket/continuation.ts` signs a continuation token with `BASKET_CONTINUATION_SECRET` so a follow-up call resumes without server-side session storage.
- Comparison is always on imputed totals (`comparableTotal`, `deliveredComparableTotal`), never raw `total` — a store that stocks less would otherwise win by omission.
- Imports carry the `.js` extension on `.ts` sources throughout, because the package is ESM with NodeNext resolution.

## Dependencies Between Modules

- `routes/` and `mcp/tools/` both depend on `services/`; neither depends on the other, and `services/` never imports from either.
- `services/` may use `@super-mcp/db` and `@super-mcp/shared`; `lib/` holds only what no other package needs.
- Nothing here imports `services/ingestion` — the two services meet only in the database.
- Cross-package pure helpers belong in `@super-mcp/shared`, not in `lib/`. See root `docs/folder-conventions.md` for the canonical-module list.
