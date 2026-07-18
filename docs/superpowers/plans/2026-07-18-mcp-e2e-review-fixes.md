# MCP E2E Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Checkboxes track progress.

**Origin:** 2026-07-18 evening end-to-end review: real 18-line BBQ basket (17 people) for "הרצליה נווה עמל" run through the live MCP (`prepare_basket` → confirm → `optimize_basket`). Findings ranked P0-P2; full evidence in project memory `mcp-e2e-review-2026-07-18`.

**Goal:** Same basket twice → identical totals (determinism); no silent-empty answers (honesty); `near` works (geo); 18-line optimize < 2.5s (speed). Coverage/confirmation-friction fixes belong to the already-committed per-chain plan and are NOT duplicated here.

**Sequencing:**

```
Phase 0 (gate)  → Phase 1 (correctness hotfixes)  → Phase 2 (per-chain plan, existing doc)
                → Phase 3 (geocoding, independent — can run parallel to 1)
                → Phase 4 (latency, after 2: the per-chain rewrite may obsolete profiles)
                → Phase 5 (ranking polish)
```

---

## Phase 0: Land the dirty basket-flow work (hard gate)

The working tree carries another session's uncommitted agent-basket-flow files (`resolve.ts`, `resolveQuery.ts`, `resolutionDecision.ts`, `prepare.ts`, `optimize.ts`, search files, herzliya golden fixture). The per-chain plan (2026-07-18-basket-per-chain-resolution.md) already declares this a hard gate; it gates Phase 1 too — Tasks 1.1/1.2 touch `priceStoreBasket.ts` and `resolveStoreLocation.ts` which sit in that dirty set's blast radius.

- [ ] Build + full test suite green on the dirty tree
- [ ] Fix `resolve.ts` TS2783 (three overwritten null defaults; delete them) if still present
- [ ] Commit the basket-flow work as its own commit (not mixed with this plan's changes)

## Phase 1: Correctness hotfixes (small, independent, ship immediately)

### Task 1.1: Deterministic best-promo selection (P0)

**Evidence:** Two identical optimize runs 10 min apart priced the same entrecote line at the same store 159.9₪ (promo applied) then 189.9₪ (not applied). Listing `3ce1a695` has ~78 active promo rows (119/129.90/149.90/159.90/169.90 at different branches + a no-op "5% אליאקספרס" promo). Root cause: `getActivePromotionsForListings` has no ORDER BY and `pickPromoForStore` (`activePromotions.ts:73`) returns the FIRST store-specific candidate in arbitrary row order (`priceStoreBasket.ts:106`).

**Files:**
- Modify: `services/api/src/services/promotions/activePromotions.ts`
- Modify: `services/api/src/services/basket/priceStoreBasket.ts` (call site)
- Check other `pickPromoForStore` call sites: `services/api/src/services/products/prices.ts`
- Tests: extend `services/api/tests/services/basket/` promo tests

**Design:**
- Replace pick-first with pick-best: `pickBestPromoForStore(candidates, storeId, chainId, listPrice, qty)` evaluates `applyPromoToUnitPrice` for EVERY eligible candidate (eligible = store-specific for THIS store, or chain-wide `store_id IS NULL` for this chain) and returns the one with the lowest applied `effectiveTotal`. A promo that doesn't apply (`applied: false`) never beats one that does.
- Semantics change, document it: today store-specific beats chain-wide even when worse; new rule is cheapest-eligible-wins (that is what checkout does).
- Determinism: tie-break equal effective totals by `promo_code` asc. Dedupe candidates by `(promo_code, store_id)` when building the map — the item-code join fans the same promo out multiple times.
- Defense in depth: add `ORDER BY pr.promo_code` to the SQL so map insertion order is stable regardless.

**Steps:**
- [ ] Failing test: listing with two overlapping store-specific promos where the LAST candidate in array order is cheaper → best one wins; assert same result after shuffling candidate order
- [ ] Failing test: no-op promo (simple_discount without discountedPrice) + real promo → real promo wins regardless of order
- [ ] Failing test: duplicate rows for one promo_code dedupe to one candidate
- [ ] Implement; update both call sites; run api suite
- [ ] Acceptance: run the 18-line Herzliya basket twice via MCP → byte-identical `stores[].total`

### Task 1.2: Location honesty — never silently return empty (P1)

**Evidence:** `city="הרצליה נווה עמל"` → 0 stores matched, `warning: null`, `fallbackApplied: false`, every candidate `hasLocalPrice: false`. `near=32.17,34.83&radius_km=3` → 0 stores in 0.06s, `warning: null`.

**Files:**
- Modify: `services/api/src/lib/resolveStoreLocation.ts` (fallback ladder exists for city+near; add city-only and near-only rungs)
- Tests: extend its existing tests

**Design:**
- City scope, 0 matches: progressively shorten the requested city by trailing tokens ("הרצליה נווה עמל" → "הרצליה נווה" → "הרצליה") through the existing alias/exact matcher; on unique hit, use it with `fallbackApplied: true` and `warning: "no stores matched 'הרצליה נווה עמל'; using 'הרצליה'"`. No hit at all → keep empty result but set `warning: "no stores matched city '…'"`.
- Near scope, 0 matches: distinguish two cases. If NO store in the DB has coordinates (current reality: 0/898), warn "store coordinates unavailable; use city instead". Otherwise warn "no stores within {R}km".
- Warnings already flow through `location.warning` to prepare/optimize/list_stores; no schema change.

**Steps:**
- [ ] Failing tests: neighborhood-suffixed city falls back with warning; unknown city warns; near-with-no-geocoded-stores warns "coordinates unavailable"
- [ ] Implement fallback ladder + warnings
- [ ] Acceptance: original review query (`city="הרצליה נווה עמל"`) returns Herzliya stores + explicit warning

### Task 1.3: Bound get_promotions; make all MCP tool schemas strict (P2)

**Evidence:** `get_promotions {city, limit}` — both args silently stripped (zod non-strict), returned 200 promos / 110KB / 14s.

**Files:**
- Modify: `services/api/src/mcp/tools/stores/index.ts`, `services/api/src/services/promotions/listPromotions.ts`
- Modify: `services/api/src/mcp/tools/register.ts` (strictness for every tool)
- Migration 015 if EXPLAIN shows a missing index for the active-window scan

**Design:**
- `listPromotions`: add `limit` (default 50, max 200) and `city` params (city → store join on `pr.store_id`, plus chain-wide promos of chains present in that city). Change ORDER BY to `end_ts ASC` (soonest-ending = most actionable now).
- MCP schemas: unknown args must be a validation error, not silent stripping — agents believe their filters worked. Apply `.strict()` centrally in `registerTool` so every tool gets it.
- Perf: the global query joins `promotion_item` and aggregates before LIMIT. Push LIMIT into a CTE over `promotion` first, aggregate item_codes only for the selected page. Target < 1s.

**Steps:**
- [ ] Failing test: `limit` respected; unknown arg rejected (pick one tool + registerTool-level test)
- [ ] Implement params + strictness + paged aggregation; EXPLAIN before/after
- [ ] Acceptance: `get_promotions{city:"הרצליה",limit:10}` → 10 rows, <1s

## Phase 2: Execute the per-chain resolution plan (P1, biggest product value)

Already fully planned in `docs/superpowers/plans/2026-07-18-basket-per-chain-resolution.md` (equivalence sets, risk classifier, one-shot optimize). It is the fix for: 8/18 best-store coverage, cucumbers "not_carried_by_chain", 17/18 confirmation questions, and most of the auto-resolve traps (its Task 1 closes the קרח→קרחון prefix hole).

**One addition while in there (fixes the Coke case):**
- [ ] Chain-coverage prior in candidate ranking / primary pick: the only auto-resolved line (confidence 1) chose the Coke 1.5L sold by ONE chain (סלח דבאח, zero Herzliya presence) over the 6-chain mainstream GTIN with 5 Herzliya price rows. When building/ordering an equivalence set, rank the primary by `count(distinct chain_id via listing)` and `hasLocalPrice` — both already computed in the candidate pipeline. Regression test: query "קוקה קולה 1.5 ליטר" in Herzliya must auto-resolve to a locally-priced product.

## Phase 3: Geocode stores — turn `near` on (P0 data gap; independent, parallelizable with Phase 1)

**Evidence:** 0/898 stores have lat/lng (feeds don't carry them; parser reads Latitude/Longitude but all NULL). The MCP server instructions actively recommend `near=lat,lng`; the entire geo path returns empty.

**Files:**
- New script: `packages/db/src/scripts/geocodeStores.ts` (fits existing scripts convention)
- Migration 015/016: `store.geo_source text` (`'feed' | 'address' | 'city_centroid'`) for provenance
- Modify: end-of-ingest hook (or cron) to geocode only new/NULL stores

**Design (two tiers, cheap first):**
1. **City centroids now:** bundle a static CBS locality→lat/lng table (public data, ~1,500 rows) as a db seed; fill NULL stores with their city centroid, `geo_source='city_centroid'`. Zero cost, immediate: `near` becomes useful at city granularity the same day.
2. **Address geocoding after:** Nominatim structured queries (street+city, countrycodes=il, 1 rps ≈ 15 min for 898 stores, cache results) upgrading rows to `geo_source='address'`. Google Geocoding via GCP is the fallback if Hebrew address hit-rate is poor.
- `resolveStoreLocation`: when a near-scope result is served entirely from centroids, append a precision note to `location.warning`.
- Guard: reuse `normalizeStoreCoordinates` Israel-bounds check on every write.

**Steps:**
- [ ] Migration + seed centroid table; backfill script tier 1; verify `near=32.1717,34.8340 r=3` returns Herzliya stores with distanceKm
- [ ] Tier 2 address pass; report hit-rate; keep centroid rows where geocoding fails
- [ ] Wire into ingest tail for new stores
- [ ] Acceptance: the review's original Neve-Amal query works end-to-end

## Phase 4: Latency (after Phase 2 — its rewrite changes the hot path)

Measured (local): prepare 18 lines 1.4-1.8s ✓; optimize ≈1.2s + **0.4s/line sequential even with product_ids** (18 lines → 8-12s); compare_prices 2.3s; suggest_substitutes 3.5s.

- [ ] Profile `resolveItems` (`services/api/src/services/basket/resolve.ts`): the per-line work is sequential awaits. Batch product_id lines into one bulk fetch; run query-resolution lines under a small `Promise.all` cap (embedding call per line is the floor). Target: optimize with confirmed ids < 2s, prepare < 2.5s.
- [ ] EXPLAIN compare_prices / suggest_substitutes — both likely pay the same promo fan-out join Task 1.1 touches; index or pre-dedupe accordingly.
- [ ] Non-goal: P4 embedder-drain batching stays deferred (write path, unrelated).

## Phase 5: Ranking polish (P2)

- [ ] **Brand transliteration variants:** "קפה נמס טסטרס צויס" scored 0.0164 (raw RRF 1/(60+1)) on the CORRECT products — the lexical arm missed because the catalog spells it "טייסטרס"/"טסטר'ס". Fold yud-variants (טייסטרס↔טסטרס) and geresh/apostrophe in the shared query normalizer (same family as the A2/A3 unit-alias fix). Regression: that query must produce a lexical-tier score, not RRF-floor.
- [ ] **Stop exposing raw RRF as `score`:** agents read 0.016 as "garbage match" and re-ask. Emit calibrated tiers or `matchedVia` + rank instead of the raw fusion constant.
- [ ] **Generic-prefix beats specific:** "סלט חומוס" ranks bare "חומוס" above "סלט חומוס אחלה 1 ק\"ג". Exact-phrase-over-subset ordering in the ranked CTE (coordinate with per-chain plan Task 1 which edits the same arms — do this after it lands).
- [ ] **Unit-count vs per-kg quantities:** "3 פלפלים" against a per-kg product silently prices 3 kg; weighted amounts ceil to whole 1000g packs (1.75kg → 2). Document the semantics in the `amount`/`unit` schema descriptions now; a typical-weight table for produce units→kg is a separate follow-up decision.

---

## Verification (whole plan)

- [ ] Golden: extend `services/api/tests/services/basket/herzliyaGolden.test.ts` — same basket twice → identical totals (locks Task 1.1)
- [ ] Re-run the full review script (memory `mcp-e2e-review-2026-07-18` documents every call): expect city fallback warning, near working, ≥15/18 coverage at best store (per-chain plan's own acceptance), optimize < 2.5s, get_promotions bounded
- [ ] Full suite green; commits per task, no mixed concerns
