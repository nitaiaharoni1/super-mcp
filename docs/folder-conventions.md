# Folder conventions

Target layout for the `super-mcp` pnpm monorepo. Prefer updating this doc when moving code rather than scattering one-off README notes.

## Top level

| Path | Purpose |
|------|---------|
| `packages/` | Libraries consumed by services (`shared`, `db`) |
| `services/` | Deployable apps (`api`, `ingestion`) |
| `data/` | Local raw feed archive + fixtures (not committed at scale) |
| `docs/` | Product spec (`SPEC.md`) and engineering plans |
| `founder-outputs/` | Ad-hoc research notes (not runtime) |
| `.local/` | Machine-local secrets (API keys); gitignored |
| `tsconfig.base.json` | Shared TypeScript compiler defaults |

There is no root `scripts/` folder — package scripts live in each workspace `package.json`; DB/ingest CLIs live under `packages/db/src/scripts/` and `services/*/src/`.

## `@super-mcp/shared` (`packages/shared/src/`)

Pure functions and types with **no I/O**. Organized by domain:

```
types/          Adapter contract, GeoPoint, AppError, semantic types
utils/          Units, cities, promo math, text scrubbing, env config, concurrency
embeddings/     Local embedder + vector helpers
intent/         Ontology fixture, semantic matcher, product intent/aliases
```

**Rule:** If two or more packages need the same pure helper, it belongs here. Env vars prefixed `SUPER_MCP_*` are resolved in `utils/config.ts`.

## `@super-mcp/db` (`packages/db/src/`)

Postgres access only:

```
client/         Pool, transactions
schema/         Migrations, GTIN SQL helpers
queries/        Upserts and reads grouped by entity (products, prices, …)
queries/semantic/  Embedding drain, ontology load
scripts/        CLI entrypoints (migrate, seed, semantic-index, …)
```

**Rule:** No HTTP, no FTP, no feed parsing. Services call `@super-mcp/db` for persistence.

## `@super-mcp/api` (`services/api/src/`)

```
routes/         Fastify route modules + Zod schemas per resource
services/       Business logic (basket/, search/, products/, …)
mcp/            MCP server + tools/{products,basket,stores}/ per-tool modules
lib/            API-only helpers (geo SQL, errors, feature-flag re-exports)
openapi/        OpenAPI fragment builders
```

**Rule:** `routes/` parse/validate; `services/` query DB and shared; `lib/` holds HTTP/SQL glue not needed elsewhere.

Import from domain folders (`services/basket/`, `services/search/`, etc.) — no flat shim files at `services/*.ts`.

## `@super-mcp/ingestion` (`services/ingestion/src/`)

```
sources/        One folder per adapter (cerberus/, shufersal/, publishprice/, …)
sources/common/ Shared adapter utilities (FTP pool, feed metadata)
pipeline/       Orchestration stages (run, parse, normalize, persist, enrich)
xml/            Feed decode + XML parsers (stores, prices, promos)
normalize.ts    RawRecord → DB upserts (uses @super-mcp/shared scrub/chain names)
regions.ts      Gush Dan–Sharon store filter
ilDate.ts       Israel wall-clock date helpers
pipeline.ts, xml.ts, adapters/  Thin re-export shims for legacy import paths
```

**Rule:** Adapters implement `SourceAdapter` from shared; pipeline never imports API code.

## Cross-package dedup checklist

When adding code, check these shared modules first:

| Concern | Canonical module |
|---------|------------------|
| Async worker pool | `@super-mcp/shared` → `mapPool`, `fileConcurrency` |
| Embed model / ontology env | `@super-mcp/shared` → `resolveEmbedModel`, `resolveOntologyVersion`, `resolveEmbedBackend` |
| Semantic basket flags | `@super-mcp/shared` → `semanticBasketEnabled`, `semanticBasketShadow` |
| NUL-byte scrubbing | `@super-mcp/shared` → `scrubString`, `scrubJson`, `scrubNullChars` |
| Chain display names | `@super-mcp/shared` → `lookupChainNames` |
| GTIN / units / promo | `@super-mcp/shared` → `utils/units`, `utils/promo` |
| GeoPoint type | `@super-mcp/shared` → `types`; haversine SQL stays in `api/lib/geo` |

## Tests

Per-package `tests/` trees mirror `src/` (no colocated `src/**/*.test.ts`). Example: `services/api/tests/services/basket.intent.test.ts` maps to `src/services/basket/`. Shared fixtures live in `packages/shared/test-utils` (`@super-mcp/shared/test-utils`); per-package helpers in `test/helpers/`.

Run from repo root:

```bash
pnpm test
pnpm typecheck
```
