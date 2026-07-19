# Label-first resolution: cleanup + 2 new labels + alias dictionary

**Status:** planned, not started. Builds on the shipped classification (migration 017,
97.2% coverage, commit 8fd90fc). Cost of the extra classification pass: ~$1–3 on handi
Vertex credits (flash-lite, same pipeline).

## Why (one line each)
- Hummus: search stops at 10 exact-name orphan SKUs nobody nearby sells; the real
  "חומוס מסעדות צבר" (14 Herzliya stores) is never fetched.
- Cucumbers/onions/peppers: word-matching guards break on Hebrew morphology
  (מלפפונים vs מלפפון, בצל vs בצל יבש) — labels already encode the truth.
- Ice: no Herzliya store publishes a real ice bag; we offer ice pops instead of
  saying "not sold here".
- Coke Zero / cherry tomato / organic: same L3 as the regular item — the one gap
  labels don't cover today (handled by fragile word lists + penalties).
- Brand: product.brand is only 32.7% populated → brand-pinning (טסטרס צ'ויס) is
  blind for 2/3 of the catalog.

## Phase A — cleanup + quick wins (no new data needed)

1. **Delete dead code:** `buildEquivalenceSet` + its describe block (zero production
   callers — verified).
2. **Label-first grouping:** in `buildCommodityEquivalents`, `buildAvailabilityEquivalents`,
   and `commodityCoverage.filterClassPeers`: when BOTH candidates carry a classL3,
   the class comparison replaces the query-token / content-token word filters
   (singular/plural stops mattering; בצל יבש groups with בצל). Word filters remain
   ONLY when either side is unlabeled (~3% + new products), plus the פרוס family
   (sliced deli items keep the produce label, so the word guard must stay for them).
3. **Re-land the exact-probe fall-through** (scoredSearch.ts, ~10 lines): when
   exact-name hits exist but NONE has a local price, continue to the wider lexical
   search. Was reverted on 2026-07-18 because it surfaced חומוס קלוי (snack);
   labels now exclude that (snacks ≠ spreads), so it's safe.
4. Golden validation after A alone: expect hummus → cheapest real spread; onion/
   pepper/cucumber priced at every carrying store.

## Phase B — two new labels (one extra classification pass)

Re-run `classifyProducts.ts` with an extended schema (same call, 2 added fields —
marginal cost only):

5. **`variant` (closed enum, ~12 values):** `regular | diet_zero | sugar_free |
   decaf | organic | premium | baby_mini | cherry_grape | sliced_prepared |
   whole_wheat | lactose_free | other`.
   - Rule: a **generic query prefers `regular`** (cheapest among regular); an
     explicit query token (זירו, אורגני, שרי) **requires** that variant.
   - Replaces three fragile word systems at once: the NEUTRAL_TOKENS variety guard,
     most of the preserved/sliced word list, and (partially) the diet/zero
     penalty rules. Fixes Coke-Zero-for-regular and cherry-for-regular cleanly.
6. **`brand` (extracted free text, nullable):** normalized brand pulled from the
   name ("קפה נמס טסטרס צ'ויס" → "טסטרס צ'ויס"). Fills the 67% gap so
   brand-pinning works catalog-wide. Extraction, not classification — free text is
   acceptable here because brands are matched by token equality, not grouped.
   Feed-provided brand keeps precedence when present.
   - Rejected extras (don't help): kosher certification (not a purchase decision
     in pricing), country of origin, packaging material.

7. **Migration 018:** add `variant text`, `brand_extracted text` to
   product_class_map (or widen columns in place — same table, same staleness rule).

## Phase C — query alias dictionary (label-first retrieval; the speed win)

8. **Checked-in Hebrew alias map per L3/L2 family** (~150 entries, generated once
   by LLM, human-reviewable in the PR): `onion: [בצל, בצלים, בצל יבש, בצל לבן]`,
   `lemon: [לימון, לימונים]`, `ice_bag: [שקית קרח, קרח בשקית, קוביות קרח לקירור]`…
9. **Retrieval:** a short query that matches an alias resolves **by label, not by
   name search**: fetch all local products with that L3 directly (indexed lookup,
   no trigram scan) → faster AND immune to name spelling. Falls back to today's
   search when no alias matches.
10. **Honest not-available falls out free:** "שקית קרח" maps to family `ice_bag`;
    zero local products carry that label → answer "not sold in these stores'
    listings" instead of offering ice pops.

## Validation gates (golden BBQ, before each commit)
- Phase A: hummus auto-resolves to a real spread ≤ ~15₪/400g; produce lines priced
  at every chain that stocks them; no pickled/snack/spice substitution; tests green.
- Phase B: generic קוקה קולה → regular (never zero) WITHOUT the penalty word-list;
  עגבניות → regular tomatoes wherever they exist, cherry only at cherry-only stores
  (flagged); טסטרס צ'ויס never swaps brand even where feed brand is NULL.
- Phase C: "בצל" retrieval returns every local onion SKU in one indexed query;
  שקית קרח honestly absent; retrieval latency for staple queries drops (no fuzzy scan).
- Determinism ×2, full suites, explicit-file commits only (shared repo).

## Ordering & effort
A is pure code (half a day, big accuracy win). B is one cheap re-classification +
small read-side rules. C is the deepest change (retrieval path) — do last, it
benefits from B's variant field. Each phase lands and validates independently.
