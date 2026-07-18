# Agent-Specific Basket Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Enforce prepare→price so agents send specific location + products, and the API never prices unconfirmed shortlists.

**Architecture:** Split basket into resolve-only (`prepareBasket`) and price-only paths; `optimizeBasket` prices solely safely resolved product IDs; ontology penalties encode silent defaults (diet/zero/pickled/dessert); MCP tools guide the agent.

**Tech Stack:** TypeScript, Vitest, Fastify API, MCP tools, Postgres ontology terms.

## Global Constraints

- Wrong product worse than unresolved / needs_confirmation.
- No Hebrew attribute-name branches in matcher — defaults via ontology data.
- Silent defaults unless low confidence (user-approved).
- Do not commit unless asked.

---

### Task 1: Price only safely resolved product IDs

**Files:**
- Modify: `services/api/src/services/basket/optimize.ts`
- Modify: `services/api/tests/services/basket/optimizeCompleteness.test.ts`
- Create/Modify: `services/api/tests/services/basket/optimizePricingScope.test.ts`

- [x] Write failing test: when all lines need confirmation, `loadBasketPricingData` is not called / productIds empty / returns quickly with cheapest null
- [x] Write failing test: when one line is resolved, only that productId (not full shortlist) is passed to pricing
- [x] Implement `collectProductIdsForPricing` filtering to resolved-safe IDs only
- [x] Keep early return when productIds empty
- [x] Run tests

---

### Task 2: `prepareBasket` service + MCP tool

**Files:**
- Modify: `services/api/src/services/basket/optimize.ts` or new `prepare.ts`
- Modify: `services/api/src/services/basket/index.ts`
- Modify: `services/api/src/mcp/tools/basket/index.ts`
- Modify: `services/api/src/openapi/basket.ts` (if REST exposed)
- Test: MCP/tool registration + prepare shape

- [x] Extract shared resolve path used by prepare and optimize
- [x] `prepareBasket` returns items + completeness + assumptions (applied defaults) without pricing
- [x] Register `prepare_basket` MCP tool; update `optimize_basket` description to prefer product_id after prepare
- [x] Tests

---

### Task 3: Silent shopping defaults (ontology)

**Files:**
- Modify: `packages/db/src/migrations/009_...` or new `010_shopping_defaults.sql`
- Live DB insert if migrate already applied
- Test-utils ontology fixtures if needed
- Unit: query profile / rank prefers regular cola over diet when query is bare קולה

- [x] Add penalty terms for diet/zero/light when query has no such token (via existing penalty machinery + rank)
- [x] Ensure produce/ice/dessert gates already cover מלפפונים/קרח (verify; extend if gap)
- [x] Apply migration / live SQL
- [x] Tests for cola default preference

---

### Task 4: Agent guidance + REST parity

**Files:**
- Modify: MCP tool descriptions
- Modify: README basket section briefly
- OpenAPI if prepare is REST-exposed

- [x] Document prepare → optimize with product_ids
- [x] Require city/near (already required)

---

### Task 5: Verify Herzliya spin latency + review

- [x] Re-run BBQ basket; expect search-bound time when 0 resolved
- [x] Full test suite + typecheck
- [x] Fix remaining issues from review
