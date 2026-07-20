# Intent-Driven Pack Equivalence Design

**Date:** 2026-07-19  
**Status:** Implemented (`fix/intent-pack-equivalence`)  
**Branch:** `fix/intent-pack-equivalence`

## Problem

Valid local substitutes were rejected for structural reasons unrelated to user intent:

1. **Raw unit-string gating** — `kg`≠`g`, `יח`≠`unit` in shortlist equivalence while coverage used canonical units inconsistently.
2. **Unit vs weight for loose produce** — primary onion SKU stored as `unit`; store peers as `1000g` → `not_carried_by_chain` despite priced onions on shelf.
3. **Hebrew morphology gap** — stem gate required token length > 4, so `פיתות`≠`פיתה`.
4. **Primary-SKU over-constraint** — selected product’s pack/unit/brand leaked into equivalence constraints the user never stated.
5. **Missing persisted sale facts** — feed `bIsWeighted` and multipack piece counts discarded after ingest-time parse.

## Decisions

| Topic | Decision |
|-------|----------|
| Architecture | Hybrid: persist objective pack/sale facts; interpret user intent at request time |
| Unit comparison | Single `packSizesCompatible` in `@super-mcp/shared` for equivalence + coverage |
| Produce count↔weight | Allowed when class is produce (or name-inferred unit pack vs weight multipack) |
| Morphology | Shared Hebrew stem; short nouns (`פיתות`/`פיתה`) must match |
| Brand/wine specificity | Explicit query tokens remain required; do not inherit primary brand for generic queries |
| DB | Additive migration `019_sale_pack_facts` + backfill; no pita/onion-specific tables |

## Non-goals

- Per-SKU hardcoding for pita/onion/wine
- Auto-substituting across variants (diet/organic/cherry) without query signal
- Replacing LLM taxonomy with size fields

## Success criteria

- Neve Amal prices onions and pita when local class peers exist
- kg↔g and יח↔unit aliases group packaged peers
- 750ml vs 2L wine still excluded by pack tolerance
- Generic wine does not widen beyond query tokens
- BBQ golden + new unit/morphology tests pass
