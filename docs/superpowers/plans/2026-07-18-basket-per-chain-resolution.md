# Basket Per-Chain Resolution & One-Shot Optimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a real-world basket (the 2026-07-17 Herzliya BBQ trace: 18 Hebrew lines) resolve in ONE optimize call with ≤4 confirmation questions, ≥15/18 coverage at a full-assortment store, and a response an agent can act on — instead of 20 MCP calls, 18 questions, 11/18 coverage, and 3-4 minutes.

**Architecture:** Three changes to the existing deterministic-first pipeline: (1) a line resolves to a gated *equivalence set* instead of one global product, and pricing lets each chain use its own member of the set (fixes non-GTIN chain-scoped SKUs killing coverage); (2) a risk classifier decides which lines genuinely need a human (brand-pinned/cross-class) vs commodities that auto-resolve; (3) `optimize_basket` accepts query lines, always returns priced partial results with inline questions, and adds a coverage-first `bestNearby` recommendation alongside `cheapest`.

**Tech Stack:** Existing TS monorepo; no new dependencies. All new decision logic is pure functions in `packages/shared` / `services/api` with unit tests.

---

## PRECONDITION (hard gate)

The "Agent-Specific Basket Flow" work (currently uncommitted: `resolve.ts`, `resolveQuery.ts`, `resolutionDecision.ts`, `rankQueryCandidates.ts`, `prepare.ts`, `optimize.ts`, `types.ts` + search files) **must be committed first**. Do not start while `git status` shows those files dirty from another session. Line numbers below were read from the 2026-07-18 tree; re-anchor by symbol name, not line number, before each edit.

Fix on landing (or fold into their commit): `resolve.ts` TS2783 — the three `primaryProductId/primaryName/substitution: null` defaults before `...queryResult` are always overwritten; delete the three lines (the spread supplies them).

## Design constraints carried over from the review (must hold after this plan)

- The 2026-07-17 review found the auto-resolve gate has real holes: prefix-without-boundary scores 0.95 (`lexicalSql.ts` ranked CTE), `nameIsQuerySafe` "≤3 tokens" fallback, dead `penaltyScore`, implied constraints upgraded to explicit+hard (`constraintsFromQueryProfile`), and margin checked only against `shortlist[1]`. **Task 1 closes these first** — widening auto-resolution (Tasks 3-4) without closing them would auto-price wrong products faster.
- Pricing-time substitution was deliberately removed (memory: "Pricing no longer substitutes resolved products with lower-ranked candidates") because *un-gated* candidates substituted badly. Task 5 reintroduces substitution **only within the gated equivalence set** — that boundary is the whole point; never fall back past it.

---

### Task 1: Close the gate holes the equivalence work will lean on

**Files:**
- Modify: `services/api/src/services/search/lexicalSql.ts` (ranked CTE prefix arm)
- Modify: `services/api/src/services/basket/resolutionDecision.ts` (`nameIsQuerySafe`, margin loop)
- Modify: `packages/shared/src/intent/deterministicRank.ts` (`constraintsFromQueryProfile`, comparator penalty)
- Tests: `services/api/tests/services/basket/resolutionDecision.test.ts`, `packages/shared/tests/intent/deterministicRank.test.ts` (extend both)

- [ ] **Step 1: Failing tests**

`resolutionDecision.test.ts` — the popsicle case:

```ts
it("does not auto-resolve a mid-word prefix continuation (קרח -> קרחון לימון)", () => {
  const decision = decideResolution(
    query("קרח"),
    [
      candidate({ name: "קרחון לימון", lexicalScore: 0.95, evidence: {} }),
      candidate({ name: "קרח יבש לויסקי", lexicalScore: 0.78, evidence: {} }),
    ],
    config(),
  );
  expect(decision.status).toBe("needs_confirmation");
});

it("margin check considers every strong rival in the shortlist, not just [1]", () => {
  // A chosen at [0]; near-twin C at [2] with equal lexical score must trigger confirmation.
  const decision = decideResolution(
    query("קפה נמס"),
    [
      candidate({ name: "קפה נמס 200 גרם", lexicalScore: 0.9, evidence: { exactPhrase: true } }),
      candidate({ name: "קפה שחור טחון", lexicalScore: 0.6, evidence: {} }),
      candidate({ name: "קפה נמס עדין 200 גרם", lexicalScore: 0.9, evidence: { exactPhrase: true } }),
    ],
    config(),
  );
  expect(decision.status).toBe("needs_confirmation");
});
```

`deterministicRank.test.ts` — implied constraints must not hard-reject:

```ts
it("term-implied attributes gate as implied/ranking, not explicit/hard", () => {
  // Ontology: concept שניצל implies species=chicken. Query "שניצל תירס";
  // corn-schnitzel candidate profile carries species=none/other.
  const ranked = rankDeterministicCandidates(cornSchnitzelFixture());
  expect(ranked.find((c) => c.name.includes("תירס"))).toBeDefined(); // not filtered out
});

it("penaltyScore demotes a sole strong hit below auto-resolve tier", () => {
  const gate = gateAgainstConstraints(penalizedSoleHitFixture());
  expect(gate.tier).toBeGreaterThan(2); // penalized candidates land outside auto-resolve tiers
});
```

(Use the existing fixture builders in those test files — both already have `candidate()`/`config()`-style helpers; extend, don't reinvent.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/resolutionDecision.test.ts && pnpm --filter @super-mcp/shared exec vitest run tests/intent/deterministicRank.test.ts`
Expected: all four new cases FAIL.

- [ ] **Step 3: Implement the four closures**

a) `lexicalSql.ts` ranked CTE — the bare-prefix arm must require a word boundary to score 0.95; mid-word continuation drops to the contains score:

```sql
WHEN $1 <> '' AND (p.name ILIKE $6 || ' %' ESCAPE '\\' OR lower(p.name) = lower($1)) THEN 0.95
```

(i.e. delete the boundary-less `$6 || '%'` arm; the existing 0.9 boundary arms and 0.78 contains arm keep covering the rest. Mirror the same change in the listing-side score arms if they have a boundary-less prefix.)

b) `resolutionDecision.ts` `nameIsQuerySafe` — remove the "≤3 tokens is safe" fallback; short names are safe only when the query matches at a token boundary:

```ts
function nameIsQuerySafe(candidate: ResolutionCandidate, queryText: string): boolean {
  if (hasDominantPhrase(candidate)) return true;
  const nameTokens = tokenizeNormalized(normalizeEmbedInput(candidate.name));
  if (nameTokens.length === 0 || nameTokens.length > 3) return false;
  // Short-name fallback only counts when the query is one of the name's
  // whole tokens (or a whole-token prefix of the name), never a mid-word
  // continuation: "קרח" must not certify "קרחון לימון".
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  return queryTokens.every((qt) => nameTokens.includes(qt));
}
```

Thread `queryText` through the two call sites in `hasDeterministicEvidence` (it already receives the config; add the query param from `decideResolution`'s context).

c) `resolutionDecision.ts` margin — scan all shortlist members with comparable evidence, not just `[1]`:

```ts
const chosenLex = effectiveLexicalScore(chosen) ?? 0;
const rival = shortlist.slice(1).find((c) => {
  const lex = effectiveLexicalScore(c) ?? 0;
  return chosenLex - lex < (config.ambiguityMargin ?? 0.15) && !sameProductLine(chosen, c);
});
if (rival) return needsConfirmation("ambiguous_margin", [chosen, rival, ...rest]);
```

d) `deterministicRank.ts` — `constraintsFromQueryProfile` must preserve provenance: attributes that came from term implications / category defaults get `source: "implied", strength: "ranking"` (match `extractConstraints`' behavior in `semanticMatcher.ts` — reuse it if the profile object carries provenance; if it doesn't, add a `provenance` field to `QueryProfile.attributes` in `queryProfile.ts` where implications are folded in). And `compareDeterministicCandidates` must read `gate.penaltyScore`: a candidate with `penaltyScore > 0` sorts below any unpenalized candidate within the same tier, and `gateTierAllowsAutoResolve` must return false when `penaltyScore >= (config.penaltyBlockThreshold ?? 1)`.

- [ ] **Step 4: Run full shared+api suites**

Run: `pnpm --filter @super-mcp/shared exec vitest run && pnpm --filter @super-mcp/api exec vitest run`
Expected: PASS, including the existing herzliyaGolden test (if it regresses, the regression is almost certainly a fixture that relied on the boundary-less prefix — fix the fixture's expectation only after confirming the new behavior is the correct one for that case).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/search/lexicalSql.ts services/api/src/services/basket/resolutionDecision.ts packages/shared/src/intent/deterministicRank.ts packages/shared/src/intent/queryProfile.ts services/api/tests/services/basket/resolutionDecision.test.ts packages/shared/tests/intent/deterministicRank.test.ts
git commit -m "fix(basket): close auto-resolve gate holes: word-boundary prefix, name-safe fallback, full-shortlist margin, live penaltyScore, implied-constraint provenance

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Equivalence set builder (pure module + tests)

A line's equivalence set = gate-passing candidates that are interchangeable for pricing: same product class as the top pick, compatible unit family, pack size within tolerance.

**Files:**
- Create: `services/api/src/services/basket/equivalence.ts`
- Test: `services/api/tests/services/basket/equivalence.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildEquivalenceSet } from "../../../src/services/basket/equivalence.js";

const cand = (over: Record<string, unknown>) => ({
  productId: crypto.randomUUID(),
  name: "עגבניות חממה",
  sizeQty: null,
  sizeUnit: "kg",
  lexicalScore: 0.9,
  intentTier: 1,
  productClass: "produce_tomato",
  ...over,
});

describe("buildEquivalenceSet", () => {
  it("keeps gate-passing same-class, unit-compatible candidates", () => {
    const top = cand({});
    const set = buildEquivalenceSet(top, [
      top,
      cand({ name: "עגבניה תמ\"י" }),
      cand({ name: "רסק עגבניות", productClass: "canned_tomato" }), // class mismatch: out
      cand({ name: "עגבניות שרי 250 גרם", sizeQty: 0.25, sizeUnit: "kg", intentTier: 3 }), // gate fail: out
    ], { packTolerance: 0.5, maxEquivalents: 5 });
    expect(set.map((c) => c.name)).toEqual(["עגבניות חממה", 'עגבניה תמ"י']);
  });

  it("returns only the top pick when it has no class (unclassified lines never widen)", () => {
    const top = cand({ productClass: null });
    const set = buildEquivalenceSet(top, [top, cand({ productClass: null })], { packTolerance: 0.5, maxEquivalents: 5 });
    expect(set).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/equivalence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { BasketCandidate } from "./types.js";

export interface EquivalenceOptions {
  /** Relative size divergence allowed vs the top pick (0.5 = ±50%). */
  packTolerance: number;
  maxEquivalents: number;
}

/**
 * Candidates a store may price interchangeably for this line. Strictly
 * narrower than the shortlist: gate tier 1-2, identical product class to the
 * top pick, same canonical unit, pack size within tolerance. An unclassified
 * top pick gets NO equivalents — widening without a class signal is exactly
 * the un-gated substitution that was removed for picking wrong products.
 */
export function buildEquivalenceSet(
  top: BasketCandidate,
  shortlist: BasketCandidate[],
  opts: EquivalenceOptions,
): BasketCandidate[] {
  if (!top.productClass) return [top];
  const out: BasketCandidate[] = [top];
  for (const c of shortlist) {
    if (out.length > opts.maxEquivalents) break;
    if (c.productId === top.productId) continue;
    if (c.intentTier == null || c.intentTier < 1 || c.intentTier > 2) continue;
    if (c.productClass !== top.productClass) continue;
    if ((c.sizeUnit ?? null) !== (top.sizeUnit ?? null)) continue;
    if (top.sizeQty != null && c.sizeQty != null && top.sizeQty > 0) {
      const div = Math.abs(c.sizeQty - top.sizeQty) / top.sizeQty;
      if (div > opts.packTolerance) continue;
    }
    out.push(c);
  }
  return out;
}
```

`BasketCandidate` needs `productClass: string | null` and `intentTier: number | null` if the landed WIP doesn't already carry them (check `types.ts` first — `rankQueryCandidates` computes gate tiers, so plumb the value onto the candidate rather than recomputing). Add both fields where candidates are built in `rankQueryCandidates.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/equivalence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/equivalence.ts services/api/tests/services/basket/equivalence.test.ts services/api/src/services/basket/types.ts services/api/src/services/basket/rankQueryCandidates.ts
git commit -m "feat(basket): gated equivalence-set builder for per-chain pricing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Line risk classifier (pure module + tests)

Decides which lines earn a human question. Commodity lines with a coherent equivalence set auto-resolve; brand-pinned and cross-class-ambiguous lines confirm.

**Files:**
- Create: `services/api/src/services/basket/lineRisk.ts`
- Test: `services/api/tests/services/basket/lineRisk.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { classifyLineRisk } from "../../../src/services/basket/lineRisk.js";

describe("classifyLineRisk", () => {
  it("commodity: shortlist agrees on one class -> auto", () => {
    expect(
      classifyLineRisk("עגבניות", [
        { productClass: "produce_tomato", brand: null, intentTier: 1 },
        { productClass: "produce_tomato", brand: "תמ\"י", intentTier: 1 },
      ]).kind,
    ).toBe("commodity");
  });

  it("cross_class: top candidates split across classes -> confirm (קולה: drink vs candy)", () => {
    expect(
      classifyLineRisk("קולה", [
        { productClass: "soft_drink", brand: "קוקה קולה", intentTier: 1 },
        { productClass: "candy", brand: null, intentTier: 1 },
      ]).kind,
    ).toBe("cross_class");
  });

  it("brand_pinned: query names a brand -> only exact-brand candidates are safe", () => {
    const risk = classifyLineRisk("קפה טסטרס צויס", [
      { productClass: "instant_coffee", brand: "טסטרס צ'ויס", intentTier: 1 },
      { productClass: "instant_coffee", brand: "עלית", intentTier: 1 },
    ]);
    expect(risk.kind).toBe("brand_pinned");
    expect(risk.pinnedBrand).toMatch(/טסטרס/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/lineRisk.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { tokenizeNormalized, normalizeEmbedInput } from "@super-mcp/shared";

export interface RiskCandidate {
  productClass: string | null;
  brand: string | null;
  intentTier: number | null;
}

export type LineRisk =
  | { kind: "commodity" }
  | { kind: "cross_class"; classes: string[] }
  | { kind: "brand_pinned"; pinnedBrand: string }
  | { kind: "opaque" }; // no class signal at all — keep today's confirmation behavior

/**
 * A line earns a human question only when the shortlist is ambiguous in a way
 * that changes WHAT the user gets: candidates split across product classes,
 * or the query pins a brand. Same-class same-unit near-duplicates are pricing
 * detail, not ambiguity.
 */
export function classifyLineRisk(queryText: string, shortlist: RiskCandidate[]): LineRisk {
  const strong = shortlist.filter((c) => c.intentTier != null && c.intentTier >= 1 && c.intentTier <= 2);
  const pool = strong.length > 0 ? strong : shortlist;

  const queryTokens = new Set(tokenizeNormalized(normalizeEmbedInput(queryText)));
  for (const c of pool) {
    if (!c.brand) continue;
    const brandTokens = tokenizeNormalized(normalizeEmbedInput(c.brand));
    // All brand tokens present in the query = the user asked for this brand.
    if (brandTokens.length > 0 && brandTokens.every((t) => queryTokens.has(t))) {
      return { kind: "brand_pinned", pinnedBrand: c.brand };
    }
  }

  const classes = [...new Set(pool.map((c) => c.productClass).filter((x): x is string => x != null))];
  if (classes.length === 0) return { kind: "opaque" };
  if (classes.length > 1) return { kind: "cross_class", classes };
  return { kind: "commodity" };
}
```

Note on `brand_pinned` fuzziness (טסטרס צויס vs טסטרס צ'ויס): `tokenizeNormalized` must strip geresh/gershayim (׳ ״ ') during normalization — verify it does (`packages/shared/src/intent/` tokenizer); if not, add that to the normalizer with a test, since Hebrew brand names are routinely written both ways.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/lineRisk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/lineRisk.ts services/api/tests/services/basket/lineRisk.test.ts
git commit -m "feat(basket): line risk classifier — commodity vs brand-pinned vs cross-class

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire risk + equivalence into query resolution

**Files:**
- Modify: `services/api/src/services/basket/rankQueryCandidates.ts` (decision assembly — the function that currently produces `resolutionStatus`/`candidates` for a query line)
- Modify: `services/api/src/services/basket/types.ts` (`ResolvedItem` gains `equivalents`)
- Test: `services/api/tests/services/basket/resolveQuery.equivalence.test.ts` (create)

- [ ] **Step 1: Failing test**

Build on the existing resolveQuery/rankQueryCandidates test fixtures. Cases:

```ts
it("commodity line with same-class near-duplicates auto-resolves with equivalents attached", async () => {
  // 4 tomato SKUs, all tier-1 same class, no exact-name winner
  const item = await resolveFixtureLine("עגבניות", tomatoShortlistFixture());
  expect(item.resolutionStatus).toBe("resolved");
  expect(item.equivalents!.length).toBeGreaterThanOrEqual(2);
});

it("brand-pinned line without an exact brand match still needs confirmation", async () => {
  const item = await resolveFixtureLine("קפה טסטרס צויס", coffeeShortlistWithoutTastersFixture());
  expect(item.resolutionStatus).toBe("needs_confirmation");
});

it("cross-class line (קולה drink vs candy) needs confirmation", async () => {
  const item = await resolveFixtureLine("קולה", colaVsCandyFixture());
  expect(item.resolutionStatus).toBe("needs_confirmation");
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/resolveQuery.equivalence.test.ts`
Expected: FAIL — first case gets `needs_confirmation` today (this IS the 18/18 confirmation tax).

- [ ] **Step 3: Implement**

In `types.ts`:

```ts
export interface ResolvedItem {
  // ...existing fields...
  /** Gated same-class candidates a chain may price interchangeably. Present only on auto-resolved query lines. */
  equivalents?: BasketCandidate[];
}
```

In `rankQueryCandidates.ts`, where today the decision path emits `needs_confirmation` for margin-ambiguity, insert the risk check BEFORE surrendering to confirmation:

```ts
  const risk = classifyLineRisk(ctx.queryText, shortlist);
  if (decision.status === "needs_confirmation" && risk.kind === "commodity") {
    const equivalents = buildEquivalenceSet(shortlist[0]!, shortlist, {
      packTolerance: config.packTolerance ?? 0.5,
      maxEquivalents: config.maxEquivalents ?? 5,
    });
    // Near-duplicate ambiguity within one class is pricing detail, not a
    // user decision: resolve to the top pick, let stores use any equivalent.
    if (equivalents.length >= 2) {
      return { ...autoResolvedFrom(shortlist[0]!), equivalents };
    }
  }
  if (risk.kind === "brand_pinned") {
    const exactBrand = shortlist.filter((c) => brandMatches(c.brand, risk.pinnedBrand));
    if (decision.status === "resolved" && !brandMatches(chosen.brand, risk.pinnedBrand)) {
      return needsConfirmation("brand_mismatch", exactBrand.length ? exactBrand : shortlist);
    }
  }
```

Key rules:
- The commodity override applies **only** when the original decision was `needs_confirmation` due to margin between same-class candidates. `cross_class`/`opaque` risk never overrides. Vector-only candidates still can never auto-resolve (existing invariant — don't touch it).
- Brand pinning can *downgrade* a resolved line to confirmation (the trace's קולה→candy class of error), never upgrade.

- [ ] **Step 4: Run api + shared suites, esp. herzliyaGolden and optimizeCompleteness**

Run: `pnpm --filter @super-mcp/api exec vitest run && pnpm --filter @super-mcp/shared exec vitest run`
Expected: PASS. herzliyaGolden's needs_confirmation expectations for commodity produce lines will flip to resolved — review each flipped assertion: same-class flips are the feature working; ANY flipped case involving cross-class or brand candidates is a bug in your wiring.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/rankQueryCandidates.ts services/api/src/services/basket/types.ts services/api/tests/services/basket/resolveQuery.equivalence.test.ts
git commit -m "feat(basket): commodity lines auto-resolve with equivalence sets; brand/cross-class lines still confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pricing uses the equivalence set per chain

**Files:**
- Modify: `services/api/src/services/basket/priceStoreBasket.ts` (`tryOrderForItem`)
- Modify: `services/api/src/services/basket/loadPricingData.ts` (collect equivalent product ids too)
- Test: `services/api/tests/services/basket/priceStoreBasket.test.ts` (extend)

- [ ] **Step 1: Failing test**

Fixture: line resolved to Stop-Market tomato SKU with equivalents [Carrefour tomato SKU]. Carrefour store prices only its own SKU. Expected: Carrefour line priced from the equivalent, `substitution` metadata set (`reason: "chain_equivalent"`, names both products); Stop line uses the primary with no substitution flag.

- [ ] **Step 2: Run to verify it fails**

Expected: Carrefour reports `not_carried_by_chain` today.

- [ ] **Step 3: Implement**

`tryOrderForItem` becomes:

```ts
function tryOrderForItem(item: ResolvedItem): BasketCandidate[] {
  if (!item.productId) return [];
  const primary =
    item.candidates.find((c) => c.productId === item.productId) ?? fallbackCandidate(item);
  // Equivalents are the ONLY permitted fallback: same gated class/unit/pack.
  // Un-gated shortlist members must never appear here (that was the old
  // wrong-substitution bug).
  return [primary, ...(item.equivalents ?? []).filter((c) => c.productId !== item.productId)];
}
```

Keep the existing `candidate.score + 0.2 < primaryScore` guard (it becomes live again with a multi-element try order). When `matched.candidate.productId !== item.productId`, populate the line's substitution metadata via the existing `substitutions.ts` helpers with a new reason `"chain_equivalent"`.

In `optimize.ts`'s product-id collection (`collectProductIdsForPricing`), include equivalent ids so `loadBasketPricingData` fetches their listings/prices:

```ts
        .flatMap((r) => [
          ...(r.productId != null ? [r.productId] : []),
          ...(r.equivalents ?? []).map((c) => c.productId),
        ]),
```

- [ ] **Step 4: Run api suite**

Run: `pnpm --filter @super-mcp/api exec vitest run`
Expected: PASS, including the existing "pricing must not substitute lower-ranked candidates" test — if that test fails, it means equivalents leaked past the gate; fix the leak, do not loosen the test.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/priceStoreBasket.ts services/api/src/services/basket/optimize.ts services/api/src/services/basket/loadPricingData.ts services/api/tests/services/basket/priceStoreBasket.test.ts
git commit -m "feat(basket): stores price lines from the gated equivalence set with substitution transparency

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: One-shot optimize — partial totals always, questions inline

**Files:**
- Modify: `services/api/src/services/basket/optimize.ts` (remove the `totalsArePartial → cheapest: null` short-circuit)
- Modify: `services/api/src/services/basket/prepare.ts` (export the question builder for reuse)
- Modify: `services/api/src/services/basket/types.ts` (`BasketOptimizeResult` gains `questions`)
- Modify: `services/api/src/openapi/basket.ts`, `services/api/src/mcp/tools/basket/index.ts` (schema + tool description)
- Test: `services/api/tests/services/basket/optimizeCompleteness.test.ts` (extend)

- [ ] **Step 1: Failing test**

```ts
it("prices the resolved subset and returns questions inline when some lines need confirmation", async () => {
  const result = await optimizeFixture({ lines: [resolvedLine(), needsConfirmationLine()] });
  expect(result.cheapest).not.toBeNull();               // priced from the resolved subset
  expect(result.completeness.totalsArePartial).toBe(true); // still honestly labeled
  expect(result.questions).toHaveLength(1);             // the unconfirmed line's question, inline
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — `cheapest` is null today.

- [ ] **Step 3: Implement**

In `optimize.ts`, delete the early-return block that nulls `cheapest`/`multiStore` when `completeness.totalsArePartial`; instead always compute recommendations from the priced subset and attach:

```ts
  const questions = buildPrepareQuestions(
    resolvedItems.filter((i) => classifyResolutionLine(i) !== "resolved"),
    optionsLimit,
  );
  return { items: itemStatuses, stores: trimmed, storesCompared, storesTruncated,
           cheapest, multiStore, completeness, questions, location };
```

(`buildPrepareQuestions` = the question-assembly currently inside `prepare.ts` — export it; both tools share one implementation.) `completeness.totalsArePartial` stays as the honesty flag; recommendations must state the priced-line count (Task 7's shape carries `coverage`). Update the MCP `optimize_basket` description: "Lines that still need confirmation are returned as `questions`; totals cover the resolved subset (see `completeness`). Re-call with `product_id` answers to finalize." Update `openapi/basket.ts` response schema with `questions`.

- [ ] **Step 4: Run api suite**

Run: `pnpm --filter @super-mcp/api exec vitest run`
Expected: PASS. Any test asserting `cheapest === null` on partial baskets flips — that null was the wasted-50KB-response bug; update those assertions to check `totalsArePartial: true` + non-null cheapest instead.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/optimize.ts services/api/src/services/basket/prepare.ts services/api/src/services/basket/types.ts services/api/src/openapi/basket.ts services/api/src/mcp/tools/basket/index.ts services/api/tests/services/basket/optimizeCompleteness.test.ts
git commit -m "feat(basket): one-shot optimize — partial totals always priced, confirmation questions inline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Coverage-first `bestNearby` recommendation

**Files:**
- Create: `services/api/src/services/basket/recommendStores.ts`
- Modify: `services/api/src/services/basket/optimize.ts` (use it), `types.ts` (`BasketOptimizeResult.recommendations`), `openapi/basket.ts`, MCP tool description
- Test: `services/api/tests/services/basket/recommendStores.test.ts` (create)

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { pickRecommendations } from "../../../src/services/basket/recommendStores.js";

const store = (name: string, covered: number, total: number, km: number | null) =>
  ({ storeName: name, coveredLines: covered, total, distanceKm: km }) as never;

describe("pickRecommendations", () => {
  it("bestNearby maximizes coverage, then total + distance penalty", () => {
    const { bestNearby, cheapest } = pickRecommendations(
      [
        store("far-cheap", 11, 471, 9.8),
        store("near-full", 15, 610, 1.2),
        store("nearest-empty", 2, 68, 0.1),
      ],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestNearby!.storeName).toBe("near-full");   // coverage wins
    expect(cheapest!.storeName).toBe("far-cheap");     // cheapest stays what it was
  });

  it("distance breaks ties between equal-coverage stores", () => {
    const { bestNearby } = pickRecommendations(
      [store("a", 12, 500, 8), store("b", 12, 510, 1)],
      { distancePenaltyPerKm: 3 },
    );
    // 500 + 24 = 524 vs 510 + 3 = 513 -> b
    expect(bestNearby!.storeName).toBe("b");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/recommendStores.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { BasketStoreResult } from "./types.js";

export interface RecommendationOptions {
  /** Shekels of "cost" per km of distance when comparing equal-coverage stores. */
  distancePenaltyPerKm: number;
}

export interface StoreRecommendations {
  /** Lowest total among compared stores (existing behavior, unchanged). */
  cheapest: BasketStoreResult | null;
  /** Most lines covered; ties broken by total + distance penalty. The answer
   *  to "where should I actually go" when no store has everything. */
  bestNearby: BasketStoreResult | null;
}

export function pickRecommendations(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): StoreRecommendations {
  if (stores.length === 0) return { cheapest: null, bestNearby: null };
  const cheapest = [...stores].sort((a, b) => a.total - b.total)[0]!;
  const bestNearby = [...stores].sort((a, b) => {
    const cov = coveredLines(b) - coveredLines(a);
    if (cov !== 0) return cov;
    return effectiveCost(a, opts) - effectiveCost(b, opts);
  })[0]!;
  return { cheapest, bestNearby };
}

function coveredLines(s: BasketStoreResult): number {
  return s.lines.length;
}

function effectiveCost(s: BasketStoreResult, opts: RecommendationOptions): number {
  return s.total + (s.distanceKm ?? 0) * opts.distancePenaltyPerKm;
}
```

In `optimize.ts`, replace the current single `cheapest` assembly: keep `cheapest` (built via the existing `buildCheapestRecommendation`) and add `bestNearby` through the same builder; expose both under `recommendations` while keeping the top-level `cheapest` field for one release (mark deprecated in OpenAPI). Default `distancePenaltyPerKm: 3`, overridable via optimize input `distance_penalty_per_km` (Zod: number, 0-100). Also change the store sort that picks `top` for `applyCheapestStoreSubstitutions` to use `bestNearby` — the substitution display should describe the store you'd actually go to.

- [ ] **Step 4: Run api suite**

Run: `pnpm --filter @super-mcp/api exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/recommendStores.ts services/api/src/services/basket/optimize.ts services/api/src/services/basket/types.ts services/api/src/openapi/basket.ts services/api/src/mcp/tools/basket/index.ts services/api/tests/services/basket/recommendStores.test.ts
git commit -m "feat(basket): coverage-first bestNearby recommendation with distance penalty

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Payload slimming — 3 options, verbose flag, honest availability

**Files:**
- Modify: `services/api/src/services/basket/prepare.ts` (options default 5→3; real `nearbyPricedStores` per option)
- Modify: `services/api/src/services/basket/optimize.ts` + `types.ts` (`verbose` input; non-verbose responses omit `stores[].lines` except for recommended stores)
- Modify: `services/api/src/services/basket/resolve.ts` / `substitutions.ts` — remove the hardcoded `hasPrice/hasLocalPrice: true` on direct-resolved candidates (fabricated signal; compute or omit)
- Modify: `services/api/src/openapi/basket.ts`, MCP descriptions
- Test: `services/api/tests/services/basket/prepareBasket.test.ts` (extend), `services/api/tests/services/basket/optimizeVerbose.test.ts` (create)

- [ ] **Step 1: Failing tests**

```ts
it("prepare questions carry at most 3 options with real nearby-priced counts", async () => {
  const result = await prepareFixture(); // fixture with 5+ candidates per line
  for (const q of result.questions) {
    expect(q.options.length).toBeLessThanOrEqual(3);
    for (const o of q.options) expect(typeof o.nearbyPricedStores).toBe("number");
  }
});

it("non-verbose optimize omits per-store line detail except recommended stores", async () => {
  const result = await optimizeFixture({ verbose: false });
  const recommendedIds = new Set([result.recommendations.cheapest?.storeId, result.recommendations.bestNearby?.storeId]);
  for (const s of result.stores) {
    if (!recommendedIds.has(s.storeId)) expect(s.lines).toHaveLength(0);
  }
});
```

- [ ] **Step 2: Run to verify failures**

Expected: FAIL — 5 options today; all stores carry full lines.

- [ ] **Step 3: Implement**

- `prepare.ts`: `DEFAULT_OPTIONS_LIMIT = 3`. Compute `nearbyPricedStores` with ONE aggregate over all option product ids (not per option):

```sql
SELECT l.product_id, count(DISTINCT sp.store_id) AS priced_stores
FROM listing l
JOIN store_price sp ON sp.listing_id = l.id
WHERE l.product_id = ANY($1::uuid[])
  AND sp.store_id = ANY($2::uuid[])  -- the stores already selected by location scope
  AND sp.price > 0
GROUP BY l.product_id
```

Replace the fabricated `hasLocalPrice: true` with this real count (`nearbyPricedStores > 0`).
- `optimize.ts`: add `verbose?: boolean` (default false) to input Zod + types; when false, strip `lines` from non-recommended `stores[]` entries just before returning (`stores: trimmed.map((s) => recommendedIds.has(s.storeId) ? s : { ...s, lines: [] })`). Keep `missingItems` on every store — coverage reasoning needs it and it's small.

- [ ] **Step 4: Run api suite + payload budget check**

Run: `pnpm --filter @super-mcp/api exec vitest run`
Then add to `optimizeVerbose.test.ts` a size budget: `expect(JSON.stringify(result).length).toBeLessThan(15_000)` for the 18-line fixture, non-verbose, 12 stores. (Trace baseline: ~50KB.)

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/prepare.ts services/api/src/services/basket/optimize.ts services/api/src/services/basket/types.ts services/api/src/services/basket/resolve.ts services/api/src/services/basket/substitutions.ts services/api/src/openapi/basket.ts services/api/src/mcp/tools/basket/index.ts services/api/tests/services/basket/prepareBasket.test.ts services/api/tests/services/basket/optimizeVerbose.test.ts
git commit -m "feat(basket): slim payloads — 3 options, verbose flag, real local-availability counts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: BBQ golden test — the trace becomes the regression bar

**Files:**
- Test: `services/api/tests/services/basket/bbqGolden.test.ts` (create; fixture style copied from `herzliyaGolden.test.ts`)

- [ ] **Step 1: Write the golden test (this IS the deliverable; it should pass with Tasks 1-8 done)**

Fixture: the exact 18-line 2026-07-17 list — פרגיות 1.75kg / קבבים 1.5kg / אנטרקוט 750g / 20 פיתות / חומוס 1.5kg / טחינה 500g / מלח גס / עגבניות 1kg / מלפפונים 1kg / 3 פלפלים / 3 בצלים / חסה / 4 לימונים / אבטיח / 2 קולה / 3 יין / קפה טסטרס צויס / שקית קרח. Catalog fixture: 2 chains (full-assortment + partial), chain-scoped produce/meat SKUs with DIFFERENT product ids per chain, one shared-GTIN cola, coffee catalog without Taster's Choice at one chain.

Assertions (the trace's failure modes, inverted):

```ts
const result = await optimizeBasket({ items: bbqLines, city: "הרצליה", verbose: false });
const auto = result.completeness.resolvedLines;
// Confirmation tax: was 0/18 auto, 18 questions.
expect(auto).toBeGreaterThanOrEqual(14);
expect(result.questions.length).toBeLessThanOrEqual(4);
// Brand + cross-class lines are exactly the ones that still ask.
const asked = result.questions.map((q) => q.query);
expect(asked).toContain("קפה טסטרס צויס");
// Coverage: was 11/18 at best store; per-chain equivalents must price
// chain-local SKUs. Full-assortment fixture chain covers everything it stocks.
const best = result.recommendations.bestNearby!;
expect(best.lines.length).toBeGreaterThanOrEqual(14);
// Partial totals are priced, never null.
expect(result.recommendations.cheapest).not.toBeNull();
// Response size: was ~50KB per optimize.
expect(JSON.stringify(result).length).toBeLessThan(15_000);
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/bbqGolden.test.ts`
Expected: PASS. Every failure here is a real product regression — treat this file as the contract for the flow; never weaken an assertion to ship.

- [ ] **Step 3: Full suite + build**

Run: `pnpm build && pnpm test`
Expected: PASS end to end (build works once the precondition TS2783 fix landed).

- [ ] **Step 4: Commit**

```bash
git add services/api/tests/services/basket/bbqGolden.test.ts
git commit -m "test(basket): BBQ golden test encoding the one-shot flow contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Success metrics (from the 2026-07-17 trace baseline)

| Metric | Trace baseline | Target |
|---|---|---|
| MCP calls for an 18-line basket | ~20 | ≤4 (1 optimize + 1 confirm round + margin) |
| Confirmation questions | 18 | ≤4 (brand/cross-class only) |
| Best-store coverage | 11/18 | ≥15/18 at a full-assortment chain |
| Nearest-store usefulness | 2/18 (Carrefour) | priced for every line its chain stocks |
| Optimize response size | ~50KB | <15KB non-verbose |
| Wall clock | 3-4 min | <60s (fewer calls dominates; server time is secondary) |

## Explicitly out of scope

- Data gaps the feeds genuinely don't cover (ice, coarse salt at some chains): the fix is honest per-line "not in any chain's published feed" labeling, which falls out of Task 8's real availability counts, not fake coverage.
- Ingestion batching / snapshot reconciliation — see `2026-07-18-correctness-perf-batch.md` deferred section.
- Embedding/vector changes: none needed; recall was never the problem in the trace.
