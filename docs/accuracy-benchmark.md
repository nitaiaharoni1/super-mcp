# Accuracy benchmark

Scores whether a basket answer is **correct**, which no other test in this repo
does. The existing suite asserts the absence of bugs already found. That is the
blind spot that let a roll-count pattern with 196 catalog false positives pass its
author's own verification: the check confirmed what it assumed.

> **The label set is MACHINE-PROPOSED and pending human review.** Until a
> Hebrew-speaking human has read `src/scripts/accuracy/labels/staples.ts`, treat
> the output as a **consistency** measure (did behaviour change?) and not as an
> **accuracy** measure (is behaviour right?). Do not quote it externally.

## Run it

```bash
# full run, writes a baseline
pnpm --filter @super-mcp/api accuracy -- --out=baseline.json

# one or two baskets while iterating
pnpm --filter @super-mcp/api accuracy -- --only=topup,produce --concurrency=1

# compare a change against a baseline; exits 1 on regression
pnpm --filter @super-mcp/api accuracy -- --baseline=baseline.json --tolerance=0.02
```

Needs `DATABASE_URL` and `BASKET_CONTINUATION_SECRET` in `.env`. It calls the
basket service directly rather than over HTTP, so no server is required. A full
10-basket run is minutes; individual baskets ranged 2.4s to 41s, the slow ones
being cold buffer cache.

## The four metrics

| metric | meaning | gated on regression |
| --- | --- | --- |
| `resolutionAccuracy` | lines resolving to a product the label accepts | yes |
| `coverage` | requested lines priced at the recommended store | yes |
| `conditionalExposure` | priced lines needing a club card or a coupon | no |
| `imputedShare` | share of the headline total that is estimated, not observed | no |

The last two are not gated because they describe the catalog and the promotion
landscape as much as the code. Failing a build on them would punish a data refresh.

### `coverage` rewards a store that lies about where it is

`coverage` scores the store the ranking picked, and the ranking prefers near
stores — so anything that makes a far store look near will raise it. Measured:
Rami Levy Ramat HaHayal had a polluted address (`דבורה הנביאה 127&#x0D;`), failed
to geocode, and fell back to the Tel Aviv centroid, 0.6 km from the benchmark
origin. It is really about 7 km away. Geocoding it correctly moved `coverage`
from 95.0% to 92.0%, and putting the centroid back restored 95.0% exactly.

Nothing about the code got worse. A big-catalog store stopped being recommended
to shoppers who would have had to drive 7 km to reach it. So before treating a
`coverage` drop as a regression, check whether store coordinates changed:
a **fall** here can mean the numbers stopped flattering themselves.
`resolutionAccuracy` is unaffected by store position and is the cleaner signal
for resolution changes.

## Baseline, measured on the full Israeli catalog

Herzliya and nearby locations, 10 baskets, 100 scored lines.

> Measured against the PHYSICAL basket surface, before the 2026-08-06 change that
> narrowed the ingest to online storefronts. The runner now drives
> `optimize_delivery`, so these figures are a record, not a baseline to compare
> against: `coverage` is now "priced at the recommended storefront" out of far
> fewer stores, and the total it scores includes delivery and service fees.
> Re-baseline before gating on a tolerance.

```
resolutionAccuracy   76.0%
coverage             92.0%
conditionalExposure   2.2%
imputedShare          6.5%
```

The useful decomposition:

```
resolutionAccuracy as scored                        76.0%
same, ignoring the availability test                97.0%
```

**21 of the 24 failures are a correctly-identified product that is thinly
stocked**, not a wrong product. Only 3 lines resolved to the wrong kind of thing
(forbidden token) and 2 to the wrong preparation. So product identity is largely
right and the weak axis is availability: resolution picks a SKU few nearby branches
carry. That matches the known shortlist-boundary limit, where a plain `טונה` query
lands on an 18-of-143-branch SKU while a 136-branch one exists outside the
retrieved candidate pool.

Weakest categories: `canned_fish` 0/3, `flour_baking` 0/1, `cleaning` 0/1,
`paper_goods` 1/4, `eggs` 2/6, `poultry` 1/3, `pasta` 1/3, `bread` 2/5.

The `controls` basket, which uses only explicit requests (`קוטג׳ תנובה 5%`,
`אורז בסמטי`, `קוקה קולה זירו`, `ביצים תבנית 12`), scored **11/11**. The system
handles a specific query well and struggles with a bare generic one, which is the
plain-versus-composite gap that `preparation` (migration 025) exists to close.

## How labels work

A label never names a product id, because the catalog is reingested and ids churn.
It pins the properties a correct answer must have:

```ts
{
  id: "rice",
  query: "אורז",
  category: "grains_rice",
  accept: {
    requireTokens: ["אורז"],              // all must appear
    requireAnyToken: ["פסטה", "ספגטי"],   // at least one must appear
    forbidTokens: ["דפי", "מקלוני"],      // none may appear
    anyOfClassL2: ["grains_rice"],
    anyOfPreparation: ["plain"],
    minNearbyStoreShare: 0.25,             // share of nearby BRANCHES, not a count
  },
}
```

`minNearbyStoreShare` is a share, not an absolute count, because the denominator
moves: 143 branches within 10km of Herzliya against 898 nationally. The first
iteration of this harness used absolute counts calibrated on national numbers and
false-failed correct answers.

A missing fact is never a failure. An unclassified product (`preparation` is NULL
for the whole catalog until the classifier runs) scores as acceptable, otherwise the
benchmark would punish the exact gap it exists to measure.

## What a reviewer should check first

1. **Availability thresholds per category.** Loose produce and fresh meat fragment
   into per-store SKUs, so a low share is structural rather than a bad answer:
   `עגבניות` resolved to `עגבניה` at 7/219 branches and `עוף` to `עוף שלם טרי` at
   10/143. Those two probably need a lower bar or none, which would move the
   headline score materially. Decide before quoting the number.
2. **One known label bug**: `oil-cooking` forbids `זית` to keep olive oil out of a
   generic `שמן` query, but `שמן קנולה עץ הזית סוגת` is canola oil from a brand
   called Etz HaZait. The label is wrong, not the system.
3. **Everything marked `confidence: "low"`**: `cottage` (should a bare קוטג׳ mean
   5%?), `dates` (does תמר לח satisfy תמרים, given the moist-form guard rejects it?).
4. **Then `confidence: "medium"`**, roughly a third of the set.

## Adding labels

Append to `STAPLE_LABELS` in `src/scripts/accuracy/labels/staples.ts`, then add the
id to a basket in `BENCHMARK_BASKETS`. `tests/accuracy/scorer.test.ts` enforces
unique ids, that every basket references a known label, that every label states at
least one positive criterion and has notes, and that no label forbids a token it
also requires. Those tests need no database.

Derive new queries from the catalog rather than intuition. In this data "most
stocked in the class" is emphatically not "the plain staple": the top-stocked item
in `grains_rice` is an instant noodle cup, in `bread` a crispbread, in `milk`
chocolate milk, and in `paper_goods` facial tissues.
