# Architecture

## Overview

A staged batch pipeline: per-retailer adapters fetch published price-transparency files, a shared pipeline decodes, normalizes, and persists them, and a separate online flow handles scraped storefronts under an explicit provenance marker.

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `src/sources/` | One folder per retailer adapter (`cerberus/`, `shufersal/`, `carrefour/`, `publishprice/`, `laibcatalog/`, `fixture/`), plus `common/` for the FTP pool and feed metadata |
| `src/online/` | The separate scraped flow (`wolt/`, `storai/`) — a different legal basis than the filed feeds, kept structurally apart |
| `src/fulfillment/` | Curated delivery-terms catalog, its area mapping, and the sync into the database |
| `src/xml/` | Feed decode plus the stores/prices/promotions parsers |
| `src/pipeline.ts`, `src/xml.ts`, `src/adapters/` | Thin re-export shims kept for legacy import paths — import from the directories instead |

## Data Flow

- `src/index.ts` → `pipeline/run.ts` selects adapters and regional files → `parse.ts` decodes XML → `normalize.ts` turns raw records into upsert rows → `persist.ts` writes through `@super-mcp/db` → `enrich.ts` drains the semantic embedding queue.
- Each file is processed by `processFile.ts`, and `status.ts` classifies the outcome so `alert.ts` can decide what is worth waking someone for.
- The online flow runs from `src/online/index.ts` on its own schedule and writes with `price_source = 'scraped'`.

## Key Patterns

- Safety rails over throughput: reconcile refuses to delete when the delete ratio looks wrong (`delete_ratio_exceeded`), an empty chain list throws instead of silently narrowing the run, and transient errors are retried through `transient.ts`.
- Adapters implement the `SourceAdapter` contract from `@super-mcp/shared`, so adding a retailer means adding a folder, not touching the pipeline.
- Provenance is a first-class field, not a comment: filed feeds and scraped reads are distinguishable in the database forever.
- Freshness decays loudly: fulfillment entries in `fulfillment/catalog.ts` carry `verifiedAt` and fall back to `unknown` rather than serving a stale number as fact.

## Dependencies Between Modules

- `sources/` → the `SourceAdapter` contract only; adapters know nothing about the pipeline that drives them.
- `pipeline/` → `sources/`, `xml/`, `@super-mcp/db`, `@super-mcp/shared`. It must never import from `services/api`.
- `online/` shares `@super-mcp/db` and `@super-mcp/shared` with the main pipeline but has its own entry point and its own persistence path.
