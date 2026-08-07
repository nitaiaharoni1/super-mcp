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

### `coverage` scores one store, so adding stores moves it

`coverage` grades the storefront the ranking picked, which makes it a measure of
the *choice* as much as of the catalogue. Adding options can lower it: pulling
the 25 Wolt venues into the local catalogue moved coverage from 96.0% to 93.0%
in one run, because a cheaper storefront with a thinner shelf started winning
baskets that a broader one used to take. Nothing resolved worse;
`resolutionAccuracy` held at 88.0% across exactly that change.

The physical surface had the same property through a different mechanism, and it
is worth keeping as the cautionary case. There the ranking preferred *near*
stores, so a store that mislocated itself scored better: Rami Levy Ramat HaHayal
had a polluted address (`דבורה הנביאה 127&#x0D;`), failed to geocode, fell back
to the Tel Aviv centroid 0.6 km from the benchmark origin when it is really 7 km
away, and geocoding it correctly *dropped* coverage from 95.0% to 92.0%.

So before treating a `coverage` fall as a regression, ask what changed about the
store set. A **fall** here can mean the numbers stopped flattering themselves.
`resolutionAccuracy` does not depend on which store won and is the cleaner
signal for resolution changes.

## Baseline, measured on the delivery surface

Measured 2026-08-07 against `optimize_delivery`, the surface that is mounted.
Herzliya and nearby locations, 10 baskets, 100 scored lines, 57 storefronts in
the catalogue of which 7 to 8 deliver to the benchmark address.

```
resolutionAccuracy   91.0%
coverage             93.0%
conditionalExposure   1.1%
imputedShare          3.2%
```

Two consecutive runs on an unchanged catalogue returned identical figures to four
decimal places, so a tight `--tolerance` is safe. The catalogue moving is what
moves the numbers, not the harness.

### Do not read the jump from 76% as an improvement

The previous record (76.0% / 92.0%) was measured on the physical branch surface.
Most of the gap is the availability test getting weaker, not resolution getting
better. `minNearbyStoreShare` is a share of the stores in scope, and that
denominator fell from 143 nearby branches to 7 or 8 serving storefronts. The same
0.25 threshold that meant "carried by 36 of 143 branches" now means "carried by 2
of 8". Availability produced 21 of 24 failures then and 2 of 9 now, on a test that
can no longer resolve anything finer than one storefront either way.

Treat `resolutionAccuracy` as a consistency measure against this baseline, and
re-derive the thresholds on storefront counts before treating the availability
axis as evidence of anything.

### The 9 remaining failures, and why 7 of them are one bug

| lines | label | query | what it picked |
|---|---|---|---|
| 4 | `yogurt-plain` | `יוגורט` | יוגורט דנונה קורנפלקס מצופה שוקולד |
| 2 | `coke-1_5` | `קוקה קולה 1.5 ליטר` | קוקה קולה **זירו** 1.5 ליטר |
| 1 | `oil-cooking` | `שמן` | שמן **זית** כתית מעולה |
| 1 | `tomatoes` | `עגבניות` | correct product, at 1 of 7 storefronts |
| 1 | `eggs-l` | `ביצים L` | correct product, at 1 of 8 storefronts |

Seven of the nine are the same failure: a bare generic query resolves to a
flavoured or specialised variant instead of the ordinary household one. That is
the gap `preparation` (migration 025) exists to close, and it is now the dominant
error mode rather than a footnote. `yogurt` scores 0/4 and `soda` 1/3 for this
reason alone.

Weakest categories: `yogurt` 0/4, `soda` 1/3, `oil_vinegar` 2/3, `eggs` 5/6,
`vegetable_fresh` 11/12. Everything else in the set scores 100%.

### A label that could never pass

`cucumbers` required the token `מלפפון` and the resolver returned a product named
`מלפפונים`. Hebrew final letters make that unmatchable: the singular ends in a
final nun (U+05DF) and the plural carries a medial one (U+05E0), so neither string
is a substring of the other and no shared prefix covers both. It failed three
lines per run against a query that was itself plural. Now `requireAnyToken`,
accepting either form, which is worth 3 points of the 91%.

Thirteen other labels use a `requireTokens` entry ending in a final letter
(`לחם`, `שמן`, `עוף`, `מים`, `יין`, `לימון`, ...). None of them is currently
failing, and every one of those tokens matches at least 30 catalogue names, so
they are live rather than broken. It is still the first thing to check when a
label fails against a product whose name obviously contains the word.

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
