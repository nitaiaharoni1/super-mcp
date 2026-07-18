# One-time LLM classification of the product catalog (product_class L1/L2/L3)

**Status:** planned, not started. Approved budget: ~$5 (Vertex credits on handi cover it).
**Owner decision points:** Phase 0 results must be reviewed by Nitai before the full run.

## Goal

Populate a 3-level product classification for all ~122K products (~110K distinct names) so
basket resolution, equivalence grouping, and per-chain coverage stop depending on name
heuristics. One-time offline job + incremental post-ingest step. **The runtime request path
never calls an LLM** — it only reads a table. If a product is unclassified, behavior is
identical to today (opaque → needs_confirmation).

Why (evidence from 2026-07-18/19 E2E sessions):
- `product_class` exists for only 6,607/122,307 products (5.4%); vocabulary is just
  `produce`/`beverage` (ontology name-rules).
- The items that break coverage (loose produce/deli: בצל, לימון, חסה) have no usable
  barcodes, so no online GTIN mapping can ever classify them. Tested Open Food Facts on
  12 random GTINs: 1/12 had categories. GS1 Israel is licensed/paid. Names are the only
  universal key.
- Class-less grouping caused: allspice-as-pepper, canned-tomatoes-as-fresh,
  scallion-as-onion, pickled-as-fresh (commodityCoverage.ts enrichment reverted for this).

## Provider & model

- **Vertex AI on the handi project** (`$HANDI_PROJECT`), account `nitai@handi.co.il`
  (the default gcloud account; credits live here. Tesse GCP is dead — do not use it).
- Auth: ADC via existing gcloud login. `--project=$HANDI_PROJECT` inline. Never set
  GOOGLE_APPLICATION_CREDENTIALS. For raw REST: `gcloud auth print-access-token`
  (refresh on 401 or every ~45 min).
- Endpoint: `https://{region}-aiplatform.googleapis.com/v1/projects/$HANDI_PROJECT/locations/{region}/publishers/google/models/{model}:generateContent`
  Region: try `me-west1` (Israel) first for latency, fall back to `us-central1`
  (broadest model availability) or the `global` endpoint.
- **Committed baseline candidates:** `gemini-2.5-flash-lite` and `gemini-2.5-flash`
  (known-available on Vertex). **Optional candidate:** `gemini-3.5-flash` — its model
  card (Gemini API docs, May 2026; preview alias `gemini-3-flash-preview`) confirms it
  exists, but NOT that it's live on Vertex or its Vertex pricing. Include it in the
  bake-off only if the ID resolves on Vertex in-region; never block the pipeline on it.
  It is not presumed better: closed-enum classification rarely benefits from frontier
  reasoning, and flash-lite may win on cost at equal accuracy — the bake-off decides.
- **If 3.5-flash participates:** it supports thinking and thinking tokens bill as
  OUTPUT — set thinking budget to 0/minimal or the cost estimate breaks. Its limits
  (1,048,576 in / 65,536 out) allow larger batches: Phase 0 A/B-tests batch size
  50 vs 200 names/request for positional-quality drift.
- **Structured output:** `generationConfig.responseMimeType: application/json` +
  `responseSchema` with **enum-constrained** fields for l1/l2/l3. Vertex enforces the
  schema server-side, so enum-validity is guaranteed by construction; temperature 0.

### Cost & time estimates (verify current Vertex pricing before Phase 1)

~110K distinct names, 50 names/request ≈ 2,200 requests; ~3.4M tokens in, ~2.5M out
(compact JSON). Realtime + parallel (no Batch ops overhead needed at this size).

| Model | Est. cost (realtime) | Note |
|---|---|---|
| gemini-2.5-flash-lite | ~$1–2 | cheapest; likely sufficient for closed-enum classification |
| gemini-2.5-flash | ~$4–8 | mid tier |
| gemini-3.5-flash | TBV (Vertex pricing not in card) | thinking budget MUST be 0 or output cost inflates |

Wall time at concurrency 16–24 with backoff: **under ~30 min** for the full catalog.
All costs land on handi Vertex credits.

## Taxonomy (closed vocabulary, checked into the repo)

File: `packages/shared/src/intent/productClassTaxonomy.ts` (or JSON next to ontology
data) — single source of truth for the classifier prompt/schema AND the read side.

- **L1 (~14):** `produce`, `meat_fish`, `dairy_eggs`, `bakery`, `pantry_dry`,
  `canned_preserved`, `spreads_condiments`, `snacks_sweets`, `beverage`, `alcohol`,
  `frozen`, `household`, `personal_care`, `non_food_other` (deposits, gift items, junk).
  L1 reuses the exact strings `produce` and `beverage` so existing gates/tests keep
  their semantics (backward compat with migrations 009/010 and ontology rules).
- **L2 (~70):** e.g. produce → `vegetable_fresh`/`fruit_fresh`/`herbs`; meat_fish →
  `poultry`/`beef`/`lamb`/`fish`/`deli_counter`; beverage → `soda`/`juice`/`water`/
  `coffee_tea`; alcohol → `wine`/`beer`/`spirits`; spreads_condiments →
  `hummus_tahini_salads`/`sauces`/`honey_jam`…
- **L3 (~150, "commodity family", nullable):** ONLY for fragmentation-critical L2s
  (fresh produce, deli spreads, fresh meat/fish, basic dairy). Examples:
  vegetable_fresh → `onion`/`scallion`/`tomato`/`cucumber`/`pepper`/`lettuce`/`lemon`;
  hummus_tahini_salads → `hummus_spread`/`tahini_raw`/`matbucha`. L3 is what fixes
  onion≠scallion, hummus-spread≠roasted-chickpeas, lemon≠lime. Everything else: null.
- No free text anywhere. Free text re-fragments and defeats grouping.

## Storage (migration 017)

```sql
CREATE TABLE product_class_map (
  product_id   uuid PRIMARY KEY REFERENCES product(id) ON DELETE CASCADE,
  class_l1     text NOT NULL,
  class_l2     text,
  class_l3     text,
  confidence   real,
  source       text NOT NULL DEFAULT 'llm',
  model        text,
  input_name   text NOT NULL,          -- name at classification time (staleness detection)
  classified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_class_map_l1_l2_idx ON product_class_map (class_l1, class_l2);
```

Deliberately OUTSIDE `product_semantic_profile` (ontology-versioned, regenerated —
reingest must not wipe this). Stale = `input_name IS DISTINCT FROM product.name` →
re-queued by the incremental run.

## Classifier script

`packages/db/src/scripts/classifyProducts.ts` (same pattern as geocodeStores.ts):

- Flags: `--sample=N`, `--model=<id>`, `--region=<r>`, `--concurrency=16`,
  `--only-missing` (default), `--stale`, `--dry-run`, `--out=csv` (for bake-off review).
- Dedupe by normalized name: classify each distinct name once, fan out the result to all
  product_ids sharing it. Context per name: name + size_qty/size_unit (+ brand if present).
- Batches of 50 names; bounded concurrency via shared `mapPool`; exponential backoff on
  429/5xx; access-token refresh on 401.
- Response schema enforces enums; script still validates l2-belongs-to-l1 and
  l3-belongs-to-l2 (hierarchy sanity) and re-asks a batch once on violation; persistent
  failures land in a `misfits.csv` for manual review, rows left unclassified.
- Transactional upsert per batch; progress + running token/cost counter in logs;
  fully resumable (`--only-missing` restarts where it stopped).

## Phases

### Phase 0 — manual bake-off (STOP for human review; nothing touches the full catalog)
1. Verify available Gemini models + current pricing in-region (one API/gcloud check).
2. Stratified sample, 300 names: 100 produce/deli-weighted, 100 random packaged,
   50 known-tricky (בצל ירוק, מלפפונים קורנישונים, פלפל אנגלי, חומוס קלוי, לימון ליים,
   לחם בצל, מלח לימון, קרחונים…), 50 with existing ontology labels (ground truth).
3. Run the SAME sample through 2–3 candidate models (flash-lite, flash, 3.x-flash),
   temperature 0. Emit side-by-side CSV: name | model A l1/l2/l3 | model B … | ontology.
4. Gates: ≥95% agreement with ontology labels on the labeled-50; ZERO catastrophic
   confusions on the tricky-50 (produce↔spice, fresh↔pickled, food↔non-food);
   review inter-model disagreements manually.
5. Present results + cost extrapolation to Nitai. **GO/NO-GO + model choice is his call.**

### Phase 1 — PILOT SLICE, not the full catalog (de-risk before spending)
- Classify ONLY the products priced in the Herzliya test scope (products with a
  store_price row in the 18 in-scope stores; measure exact count first — expected
  ~10–30K distinct names, cost cents to ~$1, minutes of wall time).
- The DB migration (017) runs once and is global — it just creates an empty table.
  What's phased is the CLASSIFICATION RUN, not the schema.
- Post-run report: rows written, class distribution histogram, misfits count, actual cost.

### Phase 2 — read-side wiring (separate commit; still zero runtime LLM)
- `loadSemanticProfiles` (or a sibling loader) LEFT JOINs `product_class_map`;
  `attributes.product_class` falls back to `class_l1` when the ontology rule didn't fire
  (ontology keeps precedence — current behavior preserved).
- Expose `classL2`/`classL3` on `BasketCandidate`; comparison rules per the
  "How L1/L2/L3 change the inference flow" section below.
- **Mixed-state safety (required for the phased rollout):** a candidate with NO map row
  is "unknown", and unknown never counts as a class disagreement — comparisons fall back
  to today's behavior. The system must be correct with 1% or 100% of the catalog classified.
- Re-land the reverted commodityCoverage enrichment **gated on deepest-shared-level
  equality** — the payoff: onion/lemon/lettuce price at every chain that carries them,
  without allspice-for-pepper drift. Confidence gate: grouping uses rows with
  confidence ≥ 0.6.

### Phase 3 — PROVE IT on the golden basket before any big run
- BBQ golden E2E on the pilot slice. Pass gates: auto-resolve ≥ 13/18 with all picks
  correct; best-store coverage ≥ 13/18; ZERO wrong-form picks (no pickled/sliced/spice/
  scallion substitutions); determinism across 2 runs; full test suites green.
- If gates fail: iterate taxonomy/prompt on the cheap slice and re-run. The full-catalog
  spend happens only after the slice demonstrably fixes resolution.
- Agreement report vs the 6,607 ontology-labeled products + 200-row spot-check CSV.
- Commits stage explicit files only (multi-session repo; never `git add -A`).

### Phase 4 — full-catalog run (only after Phase 3 passes)
- Chosen model, concurrency 16–24, remaining ~80–100K distinct names, <30 min.
- Same post-run report; then re-run Phase 3 validation once more on the full data.

### Phase 5 — incremental classification for future ingestions (offline, never request-path)
- Each ingestion run adds tens to a few hundred new products — an incremental
  `classifyProducts.ts --only-missing --stale` run is seconds and fractions of a cent.
  This is the "on demand" mode: small, bounded, automatic.
- Trigger: end-of-ingestion step in the pipeline (preferred) or a nightly cron; also
  manual `--product-ids=…` / `--since=<ts>` flags for ad-hoc runs.
- Renamed products: `input_name IS DISTINCT FROM product.name` marks them stale → same
  incremental run re-classifies.
- Between ingest and the incremental run, a new product is simply unclassified →
  today's behavior (needs_confirmation). Graceful, never blocking, never in the
  request path.

## How L1/L2/L3 change the inference flow

The pipeline SHAPE does not change (no runtime LLM, no new steps). What changes is the
precision of candidate-to-candidate comparisons in three existing decision points.
Queries themselves are never classified — the top candidate's classes stand in for
query intent, exactly like today's product_class usage.

1. **Risk classification (`classifyLineRisk`) becomes hierarchical:**
   - Top comparable candidates disagree at **L1** → true cross_class (e.g. fresh pepper
     vs spice) → still asks, as today.
   - Same L1, different **L2/L3** → candidates are DISTINGUISHABLE variants, not
     confusable near-twins → they stop blocking auto-resolve (same principle as
     today's `profilesDisagreeOnFormClass`). Net effect: FEWER questions, not more.
     Guard against the regression where richer classes make every shortlist "diverse":
     class diversity below L1 must never, by itself, force a confirmation.
   - All same at the deepest shared level → commodity → auto-resolve + equivalence.
2. **Equivalence grouping requires the deepest SHARED level to match:** both have L3 →
   L3 equality (onion ≠ scallion, hummus_spread ≠ roasted chickpeas, lemon ≠ lime);
   else both have L2 → L2 equality; else L1 + the existing token/preserved-form guards.
   Unknown-vs-known never disagrees (mixed-state rule).
3. **Resolution margin (`hasLexicalMargin`):** rivals that disagree at L2/L3 are
   distinguishable and no longer eat the lexical margin. This is what unlocks the
   currently-stuck lines: for "חומוס" the spread/dry-grains/roasted-snack rivals stop
   blocking, the ambiguity collapses to same-L3 hummus spreads → commodity → cheapest
   wins. Expected: חומוס, טחינה, קוקה קולה auto-resolve correctly.
4. **Coverage enrichment (re-landed):** the carried-SKU query joins product_class_map
   and requires deepest-shared-level equality with the primary — safe broadening that
   the name-only version couldn't achieve.

Payload/API: no change to MCP response shapes (class levels stay internal; may appear
in verbose diagnostics only).

## Risks & mitigations
- **Model availability by region** → check first; fall back us-central1/global.
- **Quota 429s** → bounded concurrency + backoff; job is resumable.
- **Same name, different actual product** → class is name-derivable by design; acceptable.
- **Junk names** (פיקדון, gift cards, fees) → `non_food_other` bucket, excluded from grouping.
- **Hebrew punctuation variance** (geresh/gershayim) → reuse `normalizeEmbedInput` for the
  dedupe key; send the raw name to the model.
- **Taxonomy churn** → adding L3 families later only requires re-classifying the affected
  L2 subset (script supports `--l2=<class>` refinement runs).
