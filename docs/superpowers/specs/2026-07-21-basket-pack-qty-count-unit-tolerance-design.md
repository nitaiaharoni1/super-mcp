# Basket pack_qty + count-unit tolerance

## Problem

Agents often send pack counts as:

```json
{ "query": "חלב 3%", "pack_qty": 3, "unit": "unit" }
```

The contract treated `unit` as belonging only to `amount`, so Zod rejected with `unit requires amount` before pricing ran. The model intent was valid: three cartons.

## Goal

Accept redundant **count** units alongside `pack_qty`, strip them, and keep rejecting real conflicts (`pack_qty` + `kg`, or both `pack_qty` and `amount`).

## Design

1. Add `isCountUnit(unit)` in `@super-mcp/shared` (aliases that canonicalize to `unit`: `unit`, `units`, `יח`, `יחידה`, `pcs`, …).
2. On both MCP and REST basket item schemas, **transform before refine**: if `pack_qty` is set, `amount` is absent, and `unit` is a count unit → drop `unit`.
3. Keep existing mutual-exclusion rules after the strip.
4. Clarify field / OpenAPI / MCP instruction text:
   - Prefer `pack_qty` alone for pack counts.
   - Prefer `amount`+`unit` for weighed goods and natural counts (e.g. 20 pitas).
   - Count units with `pack_qty` are ignored, not errors.

## Non-goals

- No protocol id bump (backward-compatible relaxation).
- No auto-conversion of `pack_qty`+`kg` into `amount`+`kg`.
- No change to purchase-qty arithmetic after parse.

## Tests

- Accept `{ pack_qty: 3 }`
- Accept `{ pack_qty: 3, unit: "unit" }` → parsed without `unit`
- Accept `{ pack_qty: 3, unit: "יח" }`
- Reject `{ pack_qty: 3, unit: "kg" }`
- Reject `{ pack_qty: 3, amount: 1, unit: "kg" }`
- Still accept `{ amount: 1, unit: "kg" }`
