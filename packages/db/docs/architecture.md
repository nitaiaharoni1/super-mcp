# Architecture

## Overview

A thin repository layer over Postgres 16 + pgvector. It owns the connection pool, the migration ledger, hand-written SQL grouped by entity, and the operational CLI scripts that drive the database.

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `src/client/` | The single `pg` pool and transaction helpers — every query in the monorepo goes through here |
| `src/schema/` | Migration runner (`migrate.ts`) and GTIN normalization SQL (`gtinSql.ts`) |
| `src/queries/` | One module per entity (products, prices, promotions, stores, chains, fulfillment, geocode), plus `semantic/` for the embedding drain and ontology load |
| `src/migrations/` | Append-only numbered `.sql` files, currently through `035_*`; a landed migration is never edited |
| `src/scripts/` | `tsx` CLI entry points (migrate, seed, embed-products, geocode-stores, integrity checks, benchmarks) — not part of the library build |

## Data Flow

- A service calls an exported query function → `client/` hands it a pooled connection → hand-written SQL runs → typed rows come back. There is no ORM and no query builder.
- Writes on the ingest hot path go through batch helpers (`batchWrite.ts`, `bulkResolveProducts`) rather than per-row statements.
- Semantic search is two-phase: `embedProducts.ts` fills the pgvector column offline, and `queries/semantic/` reads it at request time. Nothing embeds during a request.
- Geocoding is cached (`geocodeCache.ts`) in front of Nominatim, with `resolveGeocodeQuery.ts` downgrading a suspicious high-precision match to city level rather than trusting it.

## Key Patterns

- SQL lives in this package and nowhere else. A service that writes its own SQL has crossed a layer.
- Migrations are forward-only and numbered; ordering is the contract, so a new change is always the next number.
- After a bulk import Postgres planner stats are stale until an explicit `ANALYZE`, so data-loading scripts own that step.
- Imports carry the `.js` extension on `.ts` sources (ESM with NodeNext resolution).

## Dependencies Between Modules

- Depends on `@super-mcp/shared` for pure helpers and types; depends on nothing else in the monorepo.
- No HTTP, no FTP, no feed parsing — `services/ingestion` fetches and parses, this package only persists.
- Both services import this package through its compiled `dist/`, so a change is invisible to them until it is rebuilt.
