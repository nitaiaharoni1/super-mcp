# Basket Nearby Coverage + Geo Honesty Design

**Date:** 2026-07-19  
**Status:** Implemented (branch `fix/basket-nearby-coverage-geo`)  
**Branch:** `fix/basket-nearby-coverage-geo`

## Problem

A real Herzliya / Neve Amal BBQ basket produced:

1. **False low coverage** after prepare→confirm→optimize with `product_id`s — confirmed SKUs skipped commodity equivalent expansion, so other chains showed `not_carried_by_chain` despite stocking equivalents.
2. **Wrong “nearby” pick (Stop Market Arena)** — `bestNearby` maximized line coverage first; distance only broke ties. Herzliya stores all shared the city centroid `(32.1656, 34.8469)`, so distances were identical and Arena won on a tiny coverage edge.
3. **“Best place to order” conflated with in-store** — stores without storefront links could win the recommendation.
4. **Latency** — prepare + optimize each fully resolved; product_id lines hit the DB one-by-one; agents often also looped `search_products`.

## Decisions (settled with user)

| Topic | Decision |
|-------|----------|
| Nearby ranking | Prefer stores within a **1-line coverage gap** of the max, then rank by distance + total |
| Centroid coords | **Suppress distance ranking** and surface a precision warning |
| Orderability | Rank **`bestOrderable`** separately from **`bestInStore`** / `bestNearby` |

## Design

### 1. Confirmed product_id still expands equivalents

- Keep `resolvedBy: "product_id"` after confirmation.
- Stamp LLM class/variant onto the primary candidate.
- Run `enrichCommodityCoverage` for `product_id` / `gtin` / `query` lines that have `classL1`.
- Query text for peer filtering: original `items[i].query` if present, else product name.
- Pricing continues to try only primary + gated `equivalents` (no ungated shortlist fallback).

### 2. Geo precision honesty

- Expose `store.geo_source` on store summaries (`feed` | `address` | `city_centroid`).
- `location.distanceReliable = true` only when at least one in-scope store has `address` or `feed` coordinates (or `near` was not requested).
- When `near` is set and all coords are city centroids: warning + distance penalty disabled.

### 3. Recommendation ranking

- **`cheapest`:** unchanged coverage floor (~80% of max).
- **`bestNearby` / `bestInStore`:** eligible if `covered >= maxCov - 1`; among eligible, minimize `total + (distanceReliable ? distanceKm * penalty : 0)`, then prefer higher coverage.
- **`bestOrderable`:** same band on count of priced lines with non-null `link`; ignore stores with zero linked lines.

### 4. Latency

- Batch `product_id` lookups (`WHERE id = ANY(...)`).
- Batch class loads for direct + query candidates (single `loadProductClasses`).
- Keep prepare→optimize contract; do not require a resolve token in this pass.

### 5. Data

- Prefer address-geocoding Herzliya stores via `geocodeStores.ts --mode=address --city=הרצליה` when DB is available.
- API must remain correct even if geocoding is incomplete (suppress distance).

## Non-goals

- Per-store independent full search (too slow).
- Changing deterministic-first confirmation gates.
- Touching in-flight `queryHeadAnchored` work in `equivalence.ts` / `rankQueryCandidates.ts`.

## Success criteria

- product_id confirmation for a chain-A tomato UUID prices chain-B’s equivalent tomato.
- With centroid-only coords, response warns and does not prefer a farther store on fake distance.
- With address coords + 1-line band, a nearer Neve Amal store can beat Arena when coverage is within 1 line.
- `bestOrderable` never selects a store with zero linked lines when an orderable alternative exists.
- Existing BBQ golden still passes (≥14/18 coverage, ≤4 questions).
