# Agent-Specific Basket Flow Design

**Status:** Approved (conversation 2026-07-17)  
**Goal:** Agents must gather location + specific product intent before pricing. Backend enforces a two-step flow so we never price hundreds of unconfirmed candidates.

## Problem

`optimize_basket` today:

1. Resolves each free-text line to a shortlist of candidates.
2. Even when **zero** lines auto-resolve, loads listings/prices/promos for **all** shortlist product IDs across all nearby stores.
3. That pricing join is the ~100s latency on Herzliya BBQ (18 needs_confirmation lines).

Agents also send vague queries (`קולה`) without defaults, so shortlists stay wide.

## Approved behavior

1. **Prepare** — resolve items with location; apply silent shopping defaults; return assumptions + questions only when confidence is low.
2. **Price** — only for safely resolved `product_id`s (or confirmed picks). Skip pricing when none are resolved.
3. **API-enforced** — not prompt-only. Tool descriptions guide agents; backend refuses expensive work without specific inputs.

Default policy: **use common defaults silently** unless confidence is low (user choice).

Examples:

| Query | Silent default |
|-------|----------------|
| קולה / Coke | Regular Coca-Cola (not diet/zero) unless specified |
| מלפפונים | Fresh produce (not pickled) |
| קרח | Bagged ice for cooling (not popsicles) |
| יין | Ask — red/white changes the basket |

## Architecture

```
Agent → prepare_basket(city, items[])
         → resolve + defaults + completeness
         → { items, assumptions, questions }

Agent → (optional) ask user only for questions[]

Agent → optimize_basket(city, items with product_id preferred)
         → if no safely resolved IDs: return completeness, cheapest=null, NO pricing load
         → else price only those product IDs at nearby stores
```

### Backend changes

1. `collectProductIdsForPricing(resolvedItems)` — only IDs with `resolutionStatus === "resolved"` (or `productId` + `!lowConfidence`). Never fan out full shortlists into pricing when totals are partial.
2. Early return after resolve when `productIds.length === 0` (already exists) — ensure candidates-only path does not call promo join.
3. New MCP tool `prepare_basket` — same resolve as optimize, no store pricing.
4. Shopping defaults as ontology/data: soft penalties / preferred variant terms (diet/zero when query lacks those tokens). Keep matcher data-driven.
5. Tool descriptions: require city/near; instruct agents to call prepare first, then optimize with product_ids.

### Non-goals

- Full conversational checkout UI
- Hard-coded Hebrew branches in matcher (defaults stay in ontology tables)
- Auto-accept low-confidence wine/ambiguous lines

## Success criteria

- Herzliya BBQ with 0 auto-resolved lines: wall clock dominated by search (~few seconds), not promo join.
- `optimize_basket` with only `product_id` items: prices without re-search.
- Agent tool docs make prepare→confirm→price the preferred path.
- Tests cover: skip pricing when unresolved; price only resolved IDs; prepare_basket shape.
