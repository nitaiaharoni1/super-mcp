# Fast One-Call Basket Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a normal grocery-list request complete in one `optimize_basket` call with a compact, useful best-effort recommendation, while preserving strict resumable confirmation as an opt-in mode.

**Architecture:** Introduce an explicit basket resolution policy (`fast` default, `strict` opt-in) at the public boundary. Fast mode uses deterministic hard-safety constraints, accepts ordinary commodity ambiguity, omits genuinely unsafe lines instead of pausing, falls back to an embedded city without blocking on external geocoding, and returns a summary response with assumptions. Strict mode preserves the existing confirmation/continuation protocol. Measure both latency and quality with the exact Tel Aviv basket as a regression fixture.

**Tech Stack:** TypeScript 7, Node.js 22, Zod, Fastify, MCP SDK, PostgreSQL, Vitest, pnpm.

## Global Constraints

- The default MCP path for a normal shopping list must require one tool discovery and one `optimize_basket` invocation.
- `resolution_mode: "fast"` is the public default; `resolution_mode: "strict"` preserves the existing confirmation flow.
- Fast mode must never return `status: "needs_confirmation"`.
- Fast mode may return partial coverage, but must identify assumptions and omitted lines explicitly.
- Explicit `product_id`, GTIN, brand, dietary, organic, fat-percentage, pack-size, and variant constraints remain hard constraints.
- Generic query lines may use compatible locally priced commodity peers across chains.
- A weighted fresh-produce request must not resolve to canned, preserved, flour, sauce, frozen-prepared, or non-food products.
- A location containing a recognized city must not block on Nominatim in fast mode after a cache miss.
- City-level fallback must set `precision: "city"`, `distanceReliable: false`, and a user-visible warning.
- Summary responses must remain under 15 KB for the ten-line Tel Aviv fixture.
- Debug detail remains opt-in; existing `verbose` input remains accepted during migration.
- No new runtime dependencies.
- Preserve privacy: never persist or log raw free-text addresses.
- Keep imports at module tops and use exhaustive TypeScript switches for new unions.

---

## File Structure

### New files

- `services/api/src/services/basket/resolutionPolicy.ts` — fast/strict policy decisions and best-effort assumption generation.
- `services/api/src/services/basket/compactResult.ts` — summary/standard/debug response projection.
- `services/api/tests/fixtures/telAvivStaplesBasket.ts` — exact ten-line regression fixture from the failing agent flow.
- `services/api/tests/services/basket/fastBasketGolden.test.ts` — one-call quality, quantity, payload, and safety golden tests.
- `services/api/src/scripts/benchmarkFastBasket.ts` — repeatable one-call latency/quality benchmark.

### Modified files

- `services/api/src/services/basket/types.ts` — policy, detail, assumption, and result types.
- `services/api/src/services/basket/optimize.ts` — branch strict confirmations from fast best-effort pricing.
- `services/api/src/services/basket/resolve.ts` — pass resolution policy into query resolution.
- `services/api/src/services/basket/resolveQuery.ts` — carry policy and quantity intent.
- `services/api/src/services/basket/rankQueryCandidates.ts` — safe-primary selection and mode-aware resolution.
- `services/api/src/services/basket/equivalence.ts` — hard incompatibility and staple compatibility rules.
- `services/api/src/services/basket/resolutionDecision.ts` — retain strict margins; allow safe commodity ambiguity in fast mode.
- `services/api/src/services/basket/lineRisk.ts` — classify poisoned cross-domain candidates before primary selection.
- `packages/shared/src/intent/queryProfile.ts` — derive quantity/form constraints from `amount + unit`.
- `packages/shared/src/intent/semanticMatcher.ts` — apply hard form/class constraints.
- `packages/shared/src/utils/cities.ts` — extract a canonical city from free-text location.
- `packages/shared/src/index.ts` — export city extraction.
- `packages/db/src/queries/resolveGeocodeQuery.ts` — cache-first fast city fallback.
- `services/api/src/lib/locationInput.ts` — expose geocode strategy and derived city.
- `services/api/src/mcp/tools/shared/location.ts` — pass fast/precise strategy.
- `services/api/src/mcp/tools/basket/index.ts` — public mode/detail schema and discoverability copy.
- `services/api/src/mcp/tools/products/index.ts` — steer basket callers away from product-tool detours.
- `services/api/src/mcp/tools/index.ts` — register basket before product tools.
- `services/api/src/mcp/server.ts` — one-call fast-path instructions.
- `services/api/src/mcp/protocolIdentity.ts` — protocol v2 identity and contract checks.
- `services/api/src/routes/basket/schemas.ts` — REST schema parity.
- `services/api/src/routes/basket/index.ts` — map new fields and location strategy.
- `services/api/src/openapi/basket.ts` — document fast default and compact response.
- `services/api/src/scripts/canaryBasket.ts` — assert one-call default and hard latency budget.
- `services/api/src/scripts/canaryGeocode.ts` — assert location-only city fallback without network.
- `services/api/package.json` — benchmark script.
- `.github/workflows/ci.yml` — run deterministic fast-basket regression checks.

---

### Task 1: Establish the failing one-call baseline

**Files:**
- Create: `services/api/tests/fixtures/telAvivStaplesBasket.ts`
- Create: `services/api/tests/services/basket/fastBasketGolden.test.ts`
- Modify: `services/api/tests/services/basket/resumableOptimize.test.ts`

**Interfaces:**
- Produces: `TEL_AVIV_STAPLES_ITEMS: BasketItemInput[]`
- Produces: `TEL_AVIV_LOCATION = "רחוב בן גוריון, תל אביב"`
- Produces: executable acceptance criteria used by every later task.

- [ ] **Step 1: Add the exact failing fixture**

```ts
import type { BasketItemInput } from "../../src/services/basket/types.js";

export const TEL_AVIV_LOCATION = "רחוב בן גוריון, תל אביב";

export const TEL_AVIV_STAPLES_ITEMS: BasketItemInput[] = [
  { query: "חלב", packQty: 3 },
  { query: "ביצים תבנית 12", packQty: 1 },
  { query: "לחם", packQty: 2 },
  { query: "קוטג'", packQty: 2 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "תפוחי אדמה", amount: 2, unit: "kg" },
  { query: "עוף", amount: 1.5, unit: "kg" },
  { query: "אורז", amount: 1, unit: "kg" },
  { query: "שמן", amount: 1, unit: "L" },
];
```

- [ ] **Step 2: Add a golden test that initially proves the current flow pauses**

The mocked candidate set must include the observed traps:

```ts
const forbiddenFastSelections = [
  "עגבניות מרוסקות",
  "קמח תפוחי אדמה",
  "ניוקי תפוחי אדמה",
  "אמול שמן אמבט",
  "חלב בטעם אגוזי לוז",
  "6 ביצים",
];
```

Assert the future contract:

```ts
expect(result.status).toBe("complete");
expect(result.assumptions.map((entry) => entry.itemIndex)).toEqual(
  expect.arrayContaining([0, 1, 7, 9]),
);
expect(JSON.stringify(result)).not.toContain(forbiddenFastSelections.join("|"));
expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(15_000);
```

- [ ] **Step 3: Add quantity invariants**

```ts
expect(result.items[4]).toMatchObject({ amount: 1, unit: "kg" });
expect(result.items[6]).toMatchObject({ amount: 2, unit: "kg" });
expect(result.items[7]).toMatchObject({ amount: 1.5, unit: "kg" });
expect(result.items[9]).toMatchObject({ amount: 1, unit: "L" });
```

Also assert that every priced line has a positive quantity and that weighted quantities cannot silently become unrelated pack fractions such as `0.3`.

- [ ] **Step 4: Run the targeted baseline**

Run:

```bash
pnpm --filter @super-mcp/api test -- tests/services/basket/fastBasketGolden.test.ts
```

Expected: FAIL because the default path returns `needs_confirmation` and the new fields do not exist.

- [ ] **Step 5: Commit the regression fixture**

```bash
git add services/api/tests/fixtures/telAvivStaplesBasket.ts services/api/tests/services/basket/fastBasketGolden.test.ts services/api/tests/services/basket/resumableOptimize.test.ts
git commit -m "test(basket): capture one-call staples regression"
```

---

### Task 2: Add explicit fast/strict and response-detail contracts

**Files:**
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/src/mcp/tools/basket/index.ts`
- Modify: `services/api/src/routes/basket/schemas.ts`
- Modify: `services/api/src/routes/basket/index.ts`
- Modify: `services/api/src/openapi/basket.ts`
- Modify: `services/api/src/mcp/protocolIdentity.ts`
- Test: `services/api/tests/mcp/tools/index.test.ts`
- Test: `services/api/tests/mcp/protocolIdentity.test.ts`
- Test: `services/api/tests/routes/basket.test.ts`

**Interfaces:**
- Produces: `BasketResolutionMode = "fast" | "strict"`
- Produces: `BasketResponseDetail = "summary" | "standard" | "debug"`
- Produces: `BasketAssumption`
- Produces: protocol identity `basket-optimize-fast-v2`

- [ ] **Step 1: Write schema tests for defaults and compatibility**

```ts
expect(
  basketInitialBodySchema.parse({
    items: [{ query: "חלב", pack_qty: 1 }],
    city: "תל אביב",
  }),
).toMatchObject({
  resolution_mode: "fast",
  response_detail: "summary",
});

expect(
  basketInitialBodySchema.parse({
    items: [{ query: "חלב", pack_qty: 1 }],
    city: "תל אביב",
    resolution_mode: "strict",
    response_detail: "debug",
  }),
).toMatchObject({
  resolution_mode: "strict",
  response_detail: "debug",
});
```

- [ ] **Step 2: Define domain types**

```ts
export type BasketResolutionMode = "fast" | "strict";
export type BasketResponseDetail = "summary" | "standard" | "debug";

export interface BasketAssumption {
  itemIndex: number;
  query: string | null;
  selectedProductId: string | null;
  selectedName: string | null;
  reason:
    | "commodity_best_effort"
    | "generic_variant_default"
    | "location_city_fallback"
    | "unsafe_line_omitted";
  message: string;
}
```

Add to `BasketInitialInput`:

```ts
resolutionMode: BasketResolutionMode;
responseDetail: BasketResponseDetail;
```

Add `assumptions: BasketAssumption[]` to complete responses. Keep `verbose?: boolean` as a deprecated compatibility input; map `verbose: true` to `responseDetail: "debug"` only when `response_detail` is absent.

- [ ] **Step 3: Add exhaustive mapping helpers at each boundary**

```ts
function mapResolutionMode(value: "fast" | "strict" | undefined): BasketResolutionMode {
  switch (value ?? "fast") {
    case "fast":
      return "fast";
    case "strict":
      return "strict";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}
```

- [ ] **Step 4: Add public Zod fields**

```ts
resolution_mode: z
  .enum(["fast", "strict"])
  .optional()
  .default("fast")
  .describe("fast returns a best-effort priced basket in one call; strict pauses for material ambiguity."),
response_detail: z
  .enum(["summary", "standard", "debug"])
  .optional()
  .default("summary")
  .describe("Controls response size. Use debug only for diagnostics."),
```

- [ ] **Step 5: Bump and validate protocol identity**

Change:

```ts
export const BASKET_PROTOCOL_ID = "basket-optimize-fast-v2";
```

Extend `validateMcpBasketContract()` to require `resolution_mode` and `response_detail` properties while retaining `continuation` and `answers` for strict mode.

- [ ] **Step 6: Run contract tests**

```bash
pnpm --filter @super-mcp/api test -- tests/mcp/tools/index.test.ts tests/mcp/protocolIdentity.test.ts tests/routes/basket.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the contract**

```bash
git add services/api/src/services/basket/types.ts services/api/src/mcp/tools/basket/index.ts services/api/src/routes/basket/schemas.ts services/api/src/routes/basket/index.ts services/api/src/openapi/basket.ts services/api/src/mcp/protocolIdentity.ts services/api/tests/mcp services/api/tests/routes/basket.test.ts
git commit -m "feat(basket): add fast default resolution contract"
```

---

### Task 3: Implement cache-first embedded-city fallback

**Files:**
- Modify: `packages/shared/src/utils/cities.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/db/src/queries/resolveGeocodeQuery.ts`
- Modify: `services/api/src/lib/locationInput.ts`
- Modify: `services/api/src/mcp/tools/shared/location.ts`
- Test: `packages/shared/tests/utils/cities.test.ts`
- Test: `packages/db/tests/queries/resolveGeocodeQuery.test.ts`
- Test: `services/api/tests/lib/locationInput.test.ts`
- Test: `services/api/tests/services/basket/locationContinuation.test.ts`

**Interfaces:**
- Produces: `extractCityFromLocation(location: string): string | null`
- Extends: `ResolveGeocodeQueryInput` with `strategy: "fast" | "precise"`
- Extends: `resolveLocationInput()` options with geocode strategy.

- [ ] **Step 1: Write city extraction tests**

```ts
expect(extractCityFromLocation("רחוב בן גוריון, תל אביב")).toBe("תל אביב-יפו");
expect(extractCityFromLocation("אני גר במרכז תל אביב ליד בן גוריון")).toBe("תל אביב-יפו");
expect(extractCityFromLocation("נווה עמל, הרצליה")).toBe("הרצליה");
expect(extractCityFromLocation("אזור תעשייה ליד הרצליה")).toBe("הרצליה");
expect(extractCityFromLocation("אזור תעשייה")).toBeNull();
```

- [ ] **Step 2: Implement longest word-boundary city matching**

Build a private alias list from canonical city names and `CITY_ALIASES`, sorted longest-first. Match normalized text using token boundaries; do not expose alias maps or duplicate city canonicalization logic.

```ts
export function extractCityFromLocation(location: string): string | null {
  const normalized = normalizeCityKey(location);
  for (const candidate of LOCATION_CITY_CANDIDATES) {
    if (containsCityPhrase(normalized, candidate.alias)) return candidate.canonical;
  }
  return null;
}
```

- [ ] **Step 3: Write a fast geocode test proving zero network calls**

```ts
const result = await resolveGeocodeQuery({
  location: "רחוב בן גוריון, תל אביב",
  strategy: "fast",
});

expect(result).toMatchObject({
  status: "ok",
  precision: "city",
  provider: "city_centroid",
  fallbackApplied: true,
});
expect(fetch).not.toHaveBeenCalled();
```

- [ ] **Step 4: Implement strategy ordering**

Fast:

```text
normalize → derive city → HMAC cache lookup → cached Nominatim hit if present
→ immediate city centroid → not_found only when no city exists
```

Precise:

```text
normalize → derive city → HMAC cache lookup → Nominatim
→ city centroid on empty/unavailable
```

Do not persist the fast city-centroid fallback as a positive geocode hit; otherwise a later precise request would be permanently masked. Continue caching Nominatim hits and confirmed misses according to existing TTLs.

- [ ] **Step 5: Propagate canonical city and provenance**

When `location` contains a city and no explicit `city` was provided, return:

```ts
{
  city: "תל אביב-יפו",
  near: CITY_CENTROID["תל אביב-יפו"],
  locationOrigin: {
    precision: "city",
    provider: "city_centroid",
    cached: false,
    fallbackApplied: true,
    displayName: "תל אביב-יפו",
    attribution: null,
    warning: "Using city-level location for a faster estimate; distances are approximate.",
  },
}
```

- [ ] **Step 6: Preserve precise behavior for strict mode and direct location tools**

Map basket `resolution_mode: "fast"` to geocode `strategy: "fast"` and strict mode to `"precise"`. Keep non-basket product/store tools precise unless they explicitly add their own fast option later.

- [ ] **Step 7: Run geocoding tests**

```bash
pnpm --filter @super-mcp/shared test -- tests/utils/cities.test.ts
pnpm --filter @super-mcp/db test -- tests/queries/resolveGeocodeQuery.test.ts
pnpm --filter @super-mcp/api test -- tests/lib/locationInput.test.ts tests/services/basket/locationContinuation.test.ts
```

Expected: PASS with no Nominatim call for the Tel Aviv fast-path case.

- [ ] **Step 8: Commit location fallback**

```bash
git add packages/shared/src/utils/cities.ts packages/shared/src/index.ts packages/shared/tests/utils/cities.test.ts packages/db/src/queries/resolveGeocodeQuery.ts packages/db/tests/queries/resolveGeocodeQuery.test.ts services/api/src/lib/locationInput.ts services/api/src/mcp/tools/shared/location.ts services/api/tests/lib/locationInput.test.ts services/api/tests/services/basket/locationContinuation.test.ts
git commit -m "feat(location): add instant embedded-city fallback"
```

---

### Task 4: Add hard intent constraints before candidate ranking

**Files:**
- Modify: `packages/shared/src/intent/queryProfile.ts`
- Modify: `packages/shared/src/intent/semanticMatcher.ts`
- Modify: `services/api/src/services/basket/equivalence.ts`
- Modify: `services/api/src/services/basket/rankQueryCandidates.ts`
- Test: `packages/shared/tests/intent/queryProfile.test.ts`
- Test: `services/api/tests/services/basket/equivalence.test.ts`
- Test: `services/api/tests/services/basket/resolveQuery.equivalence.test.ts`

**Interfaces:**
- Produces: quantity-derived intent attributes before `decideResolution()`.
- Produces: `selectSafePrimary()` that excludes incompatible domains before choosing a display or pricing primary.

- [ ] **Step 1: Write failing produce and pack tests**

```ts
expect(profileFor("עגבניות", 1, "kg").attributes.form).toBe("fresh");
expect(profileFor("תפוחי אדמה", 2, "kg").attributes.form).toBe("fresh");
expect(profileFor("ביצים תבנית 12", null, null).attributes.piece_count).toBe("12");
expect(profileFor("שמן 1 ליטר", null, null).requestedAmount).toEqual({
  quantity: 1,
  unit: "L",
});
```

Candidate tests must prove:

```ts
expect(names).not.toContain("עגבניות מרוסקות 850 גרם");
expect(names).not.toContain("קמח תפוחי אדמה 500 גרם");
expect(names).not.toContain("ניוקי תפוחי אדמה");
expect(names).not.toContain("אמול שמן אמבט פורטה");
expect(names).not.toContain("6 ביצים L");
```

- [ ] **Step 2: Derive fresh-produce intent conservatively**

Set `form=fresh` only when all are true:

- quantity unit is `kg` or `g`;
- query maps to a produce concept or fresh produce class;
- query does not explicitly contain preserved/prepared terms.

Do not infer fresh for `"עגבניות מרוסקות 1 ק״ג"` or `"קמח תפוחי אדמה 1 ק״ג"`.

- [ ] **Step 3: Promote numeric pack constraints to hard constraints**

Parse explicit count/volume tokens from the query and compare against `pieceCount`, `sizeQty`, and `sizeUnit`. `"ביצים תבנית 12"` must reject six-packs; `"שמן 1 ליטר"` must reject 750 ml unless no compatible result exists, in which case fast mode omits the line with an assumption.

- [ ] **Step 4: Filter incompatible classes before choosing `chosen`**

Add:

```ts
interface SafePrimaryInput {
  query: string;
  profile: QueryProfile;
  candidates: BasketCandidate[];
}

function selectSafePrimary(input: SafePrimaryInput): BasketCandidate | null;
```

The function must run before `const base = …` in `rankQueryCandidates.ts`. It must reject:

- non-food or personal-care candidates for food queries;
- preserved/canned/flour/frozen-prepared candidates for inferred fresh produce;
- explicit pack/count mismatches;
- explicit variant/brand/dietary conflicts.

The same safe candidate must drive `name`, `productId`, equivalence building, and question options. This removes the current mismatch where `item.name` is bath oil while options are cooking oils.

- [ ] **Step 5: Run ranking tests**

```bash
pnpm --filter @super-mcp/shared test -- tests/intent/queryProfile.test.ts
pnpm --filter @super-mcp/api test -- tests/services/basket/equivalence.test.ts tests/services/basket/resolveQuery.equivalence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit hard intent constraints**

```bash
git add packages/shared/src/intent/queryProfile.ts packages/shared/src/intent/semanticMatcher.ts packages/shared/tests/intent/queryProfile.test.ts services/api/src/services/basket/equivalence.ts services/api/src/services/basket/rankQueryCandidates.ts services/api/tests/services/basket/equivalence.test.ts services/api/tests/services/basket/resolveQuery.equivalence.test.ts
git commit -m "fix(basket): constrain staple candidates by form and quantity"
```

---

### Task 5: Implement fast best-effort resolution without confirmations

**Files:**
- Create: `services/api/src/services/basket/resolutionPolicy.ts`
- Modify: `services/api/src/services/basket/resolve.ts`
- Modify: `services/api/src/services/basket/resolveQuery.ts`
- Modify: `services/api/src/services/basket/rankQueryCandidates.ts`
- Modify: `services/api/src/services/basket/resolutionDecision.ts`
- Modify: `services/api/src/services/basket/optimize.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Test: `services/api/tests/services/basket/resolutionDecision.test.ts`
- Test: `services/api/tests/services/basket/resumableOptimize.test.ts`
- Test: `services/api/tests/services/basket/fastBasketGolden.test.ts`

**Interfaces:**
- Consumes: `BasketResolutionMode`
- Produces: `applyFastResolutionPolicy()`
- Guarantees: fast mode returns `complete`; strict mode behavior remains unchanged.

- [ ] **Step 1: Write mode-separation tests**

```ts
const fast = await optimizeBasket({ ...input, resolutionMode: "fast" }, OPTIONS);
expect(fast.status).toBe("complete");

const strict = await optimizeBasket({ ...input, resolutionMode: "strict" }, OPTIONS);
expect(strict.status).toBe("needs_confirmation");
```

Also assert that strict resume still validates allowed product IDs and reuses cached resolved lines.

- [ ] **Step 2: Define fast-policy outcomes**

```ts
export type FastResolutionOutcome =
  | {
      kind: "selected";
      item: ResolvedItem;
      assumption: BasketAssumption | null;
    }
  | {
      kind: "omitted";
      item: ResolvedItem;
      assumption: BasketAssumption;
    };
```

Use an exhaustive switch when converting outcomes into priced and omitted lines.

- [ ] **Step 3: Implement safe commodity auto-selection**

Fast mode may accept ambiguity only when:

- the safe candidate pool is non-empty;
- candidates share a compatible class/form;
- no explicit brand, variant, dietary, organic, fat percentage, cut, or pack constraint is violated;
- the selected candidate has a local price or locally priced equivalent;
- the top candidate is not vector-only.

Prefer in this order:

1. hard-compatible candidates;
2. locally priced candidates;
3. regular/default variants;
4. requested pack/count match;
5. highest deterministic score;
6. highest nearby store/chain coverage.

- [ ] **Step 4: Define generic defaults**

Record assumptions rather than asking:

- `"חלב"` → regular cow milk, locally available common pack;
- `"ביצים תבנית 12"` → regular 12-count eggs;
- `"שמן"` with `1 L` → regular cooking oil, preferably canola when the safe local pool supports it;
- `"עוף"` with weight but no cut → cheapest common fresh chicken cut; never processed/frozen unless explicitly requested.

If no safe candidate exists, omit that line and add `unsafe_line_omitted`. Do not manufacture an answer.

- [ ] **Step 5: Branch confirmation logic in `optimize.ts`**

```ts
if (input.resolutionMode === "strict" && questions.length > 0) {
  return buildNeedsConfirmationResult(...);
}

const fastPolicy = applyFastResolutionPolicy(input.items, resolvedItems, availability);
const pricingItems = fastPolicy.items;
const assumptions = fastPolicy.assumptions;
```

Only strict mode creates continuation tokens or writes to `resolutionCache`.

- [ ] **Step 6: Preserve query quantities**

The selected equivalent may change package count, but it must preserve the requested physical amount. Add assertions in `resolvePurchaseQty` call sites:

- amount-based input remains amount-based;
- weighted listing quantities represent requested kg/L;
- `pack_qty` remains an integer pack count unless a documented count-to-weight policy applies;
- conversion metadata is included when rounding is necessary.

- [ ] **Step 7: Run policy tests**

```bash
pnpm --filter @super-mcp/api test -- tests/services/basket/resolutionDecision.test.ts tests/services/basket/resumableOptimize.test.ts tests/services/basket/fastBasketGolden.test.ts
```

Expected: fast fixture is complete in one call; strict fixture still pauses and resumes.

- [ ] **Step 8: Commit fast resolution**

```bash
git add services/api/src/services/basket/resolutionPolicy.ts services/api/src/services/basket/resolve.ts services/api/src/services/basket/resolveQuery.ts services/api/src/services/basket/rankQueryCandidates.ts services/api/src/services/basket/resolutionDecision.ts services/api/src/services/basket/optimize.ts services/api/src/services/basket/types.ts services/api/tests/services/basket
git commit -m "feat(basket): complete safe staples in one call"
```

---

### Task 6: Protect locality, coverage, and recommendation honesty

**Files:**
- Modify: `services/api/src/lib/resolveStoreLocation.ts`
- Modify: `services/api/src/services/basket/recommendationPlans.ts`
- Modify: `services/api/src/services/basket/priceStoreBasket.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Test: `services/api/tests/lib/resolveStoreLocation.test.ts`
- Test: `services/api/tests/services/basket/optimizePricingScope.test.ts`
- Test: `services/api/tests/services/basket/recommendationPlans.test.ts`

**Interfaces:**
- Produces: explicit total scope and locality reliability on recommendations.
- Guarantees: a 3 km request cannot recommend a known out-of-radius branch.

- [ ] **Step 1: Add regression tests for far-away branches**

For `near: { lat: 32.0819, lng: 34.7712 }, radiusKm: 3`, reject known coordinates outside the radius and exclude stores with unknown/unreliable distance from `multiStore` recommendations.

```ts
expect(result.multiStore?.lines.every((line) => allowedStoreIds.has(line.storeId))).toBe(true);
expect(JSON.stringify(result)).not.toContain("תלפיות");
expect(JSON.stringify(result)).not.toContain("באר יעקב");
```

- [ ] **Step 2: Separate eligible recommendation stores from informational stores**

Add a helper:

```ts
function isEligibleForDistanceRecommendation(
  store: StoreSummary,
  location: StoreLocationMetadata,
): boolean;
```

In a reliable near scope, require a reliable coordinate and `distanceKm <= radiusKm`. In city-level fallback, use city membership and suppress distance ranking.

- [ ] **Step 3: Make partial totals explicit**

Extend plan types:

```ts
totalScope: "complete_basket" | "priced_lines_only";
```

Set `priced_lines_only` whenever `coverageRatio < 1`. Summary copy and MCP descriptions must never call a partial total “the basket total.”

- [ ] **Step 4: Prefer coverage before cost**

Maintain the existing missing-item-first ordering and add tests that a 90% covered store beats a cheaper 40% covered store. A complete store always beats an incomplete store unless the caller explicitly requests a different objective in a future feature.

- [ ] **Step 5: Verify line arithmetic**

For every priced line:

```ts
expect(line.lineTotal).toBeGreaterThan(0);
expect(line.qty).toBeGreaterThan(0);
```

Where promotions make `lineTotal !== unitPrice * qty`, require `promoApplied: true` and promotion metadata. Apply the same invariant to `MultiStoreLine`.

- [ ] **Step 6: Run locality and pricing tests**

```bash
pnpm --filter @super-mcp/api test -- tests/lib/resolveStoreLocation.test.ts tests/services/basket/optimizePricingScope.test.ts tests/services/basket/recommendationPlans.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit recommendation honesty**

```bash
git add services/api/src/lib/resolveStoreLocation.ts services/api/src/services/basket/recommendationPlans.ts services/api/src/services/basket/priceStoreBasket.ts services/api/src/services/basket/types.ts services/api/tests/lib/resolveStoreLocation.test.ts services/api/tests/services/basket/optimizePricingScope.test.ts services/api/tests/services/basket/recommendationPlans.test.ts
git commit -m "fix(basket): keep recommendations local and totals honest"
```

---

### Task 7: Return a compact summary by default

**Files:**
- Create: `services/api/src/services/basket/compactResult.ts`
- Modify: `services/api/src/services/basket/optimize.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/src/openapi/basket.ts`
- Test: `services/api/tests/services/basket/optimizeVerbose.test.ts`
- Test: `services/api/tests/services/basket/fastBasketGolden.test.ts`

**Interfaces:**
- Produces: `projectBasketResult(result, detail)`
- Summary: recommendations, coverage, assumptions, omitted items, location warning.
- Standard: summary plus item statuses and recommended-store lines.
- Debug: all candidates, stores, and phase timings.

- [ ] **Step 1: Write response-shape and size tests**

```ts
expect(summary.status).toBe("complete");
expect(summary).not.toHaveProperty("stores");
expect(summary.items.every((item) => !("candidates" in item))).toBe(true);
expect(Buffer.byteLength(JSON.stringify(summary), "utf8")).toBeLessThan(15_000);

expect(debug.stores.length).toBeGreaterThan(0);
expect(debug.items.some((item) => item.candidates.length > 0)).toBe(true);
```

- [ ] **Step 2: Define a summary projection**

Summary includes:

```ts
{
  status,
  bestSingleStore,
  cheapestCompleteStore,
  multiStore,
  coverage: {
    requestedLines,
    pricedLines,
    omittedLines,
  },
  assumptions,
  omittedItems,
  location,
}
```

Do not duplicate identical store plans. Include at most two recommendation plans. Keep storefront links on recommended lines.

- [ ] **Step 3: Keep strict confirmation compact**

For strict `needs_confirmation` with summary detail, return only:

```ts
{
  status: "needs_confirmation",
  continuation,
  questions,
  preview,
  nextStep: {
    tool: "optimize_basket",
    useOnly: ["continuation", "answers"],
    doNotCall: ["search_products", "resolve_products", "compare_prices"],
  },
  location,
}
```

Do not duplicate `questions[].options` in `items[].candidates`. Standard/debug may retain full item statuses.

- [ ] **Step 4: Map deprecated verbose safely**

Precedence:

```text
response_detail supplied → use it
else verbose=true → debug
else → summary
```

- [ ] **Step 5: Run payload tests**

```bash
pnpm --filter @super-mcp/api test -- tests/services/basket/optimizeVerbose.test.ts tests/services/basket/fastBasketGolden.test.ts
```

Expected: summary under 15 KB; debug remains complete.

- [ ] **Step 6: Commit compact projection**

```bash
git add services/api/src/services/basket/compactResult.ts services/api/src/services/basket/optimize.ts services/api/src/services/basket/types.ts services/api/src/openapi/basket.ts services/api/tests/services/basket/optimizeVerbose.test.ts services/api/tests/services/basket/fastBasketGolden.test.ts
git commit -m "feat(basket): return compact recommendation summaries"
```

---

### Task 8: Make `optimize_basket` the first discovered tool

**Files:**
- Modify: `services/api/src/mcp/tools/index.ts`
- Modify: `services/api/src/mcp/tools/basket/index.ts`
- Modify: `services/api/src/mcp/tools/products/index.ts`
- Modify: `services/api/src/mcp/server.ts`
- Modify: `services/api/src/mcp/protocolIdentity.ts`
- Test: `services/api/tests/mcp/tools/index.test.ts`
- Test: `services/api/tests/mcp/protocolIdentity.test.ts`

**Interfaces:**
- Produces: discovery-first title/description and basket-first registration order.

- [ ] **Step 1: Write discovery metadata tests**

Assert the first registered tool is `optimize_basket`, and its first 200 description characters contain:

```text
shopping list
cheapest store
one call
```

- [ ] **Step 2: Register basket tools first**

```ts
export function registerTools(server: McpServer): void {
  registerBasketTools(server);
  registerProductTools(server);
  registerStoreTools(server);
}
```

- [ ] **Step 3: Rewrite the basket title and lead description**

Title:

```text
Optimize a grocery shopping list in one call
```

Description lead:

```text
For a multi-item grocery shopping list, find the cheapest suitable nearby store
or multi-store option in one call. Fast mode is the default and returns a compact
best-effort result without product-by-product searches.
```

Move strict continuation details after this searchable lead.

- [ ] **Step 4: Harden neighboring tool descriptions**

Add to `search_products`, `resolve_products`, and `compare_prices`:

```text
Do not use this for a shopping list or after optimize_basket has started.
Use optimize_basket directly; strict confirmation options are sufficient to resume.
```

- [ ] **Step 5: Rewrite server instructions around the fast path**

Lead with:

```text
Shopping list → call optimize_basket exactly once with all items and location.
Accept the default fast best-effort choices unless the user explicitly requests
exact products; then set resolution_mode=strict.
Never search or compare each basket line separately.
```

- [ ] **Step 6: Run MCP tests**

```bash
pnpm --filter @super-mcp/api test -- tests/mcp/tools/index.test.ts tests/mcp/protocolIdentity.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit discoverability**

```bash
git add services/api/src/mcp/tools/index.ts services/api/src/mcp/tools/basket/index.ts services/api/src/mcp/tools/products/index.ts services/api/src/mcp/server.ts services/api/src/mcp/protocolIdentity.ts services/api/tests/mcp
git commit -m "feat(mcp): route shopping lists to one-call optimization"
```

---

### Task 9: Add hard performance and quality gates

**Files:**
- Create: `services/api/src/scripts/benchmarkFastBasket.ts`
- Modify: `services/api/src/scripts/canaryBasket.ts`
- Modify: `services/api/src/scripts/canaryGeocode.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `services/api/src/services/basket/optimize.ts`
- Modify: `services/api/src/analytics/metadata.ts`
- Test: `services/api/tests/services/basket/fastBasketGolden.test.ts`

**Interfaces:**
- Produces: `pnpm --filter @super-mcp/api benchmark:fast-basket`
- Produces: machine-readable JSON metrics.

- [ ] **Step 1: Define benchmark output**

```ts
interface FastBasketBenchmarkResult {
  iterations: number;
  completeInOneCallRate: number;
  safeSelectionRate: number;
  medianMs: number;
  p95Ms: number;
  responseBytesP95: number;
  pricedLineCoverage: number;
}
```

- [ ] **Step 2: Implement deterministic benchmark mode**

Run the Tel Aviv fixture against a populated local database for 20 warm iterations. Emit one JSON object and exit non-zero when:

```text
completeInOneCallRate < 1.0
safeSelectionRate < 1.0
p95Ms > 3000
responseBytesP95 > 15000
pricedLineCoverage < 0.8
```

The 80% coverage gate permits missing catalog data but rejects a superficially cheap, mostly empty basket.

- [ ] **Step 3: Separate geocoding from basket timings**

Extend telemetry with:

```ts
geocodeMs: number;
geocodeStrategy: "cache" | "city_fallback" | "nominatim" | "coordinates" | "none";
resolutionMode: BasketResolutionMode;
responseDetail: BasketResponseDetail;
responseBytes: number;
```

Keep raw locations out of logs and analytics.

- [ ] **Step 4: Turn canary warnings into failures**

Fast default canary:

```text
status must be complete on the initial call
elapsed must be <= 3000 ms after warm-up
response must be <= 15000 bytes
no forbidden candidate classes
```

Strict canary remains available with `CANARY_BASKET_RESOLUTION_MODE=strict`.

- [ ] **Step 5: Add package script**

```json
"benchmark:fast-basket": "tsx src/scripts/benchmarkFastBasket.ts"
```

- [ ] **Step 6: Add CI deterministic gates**

CI always runs unit/golden tests. Run the populated-DB benchmark only in the existing benchmark job where database fixtures are available, upload its JSON artifact, and fail the job on the thresholds above. Do not silently tolerate benchmark failure.

- [ ] **Step 7: Run verification**

```bash
pnpm --filter @super-mcp/shared build
pnpm --filter @super-mcp/db build
pnpm --filter @super-mcp/api typecheck
pnpm --filter @super-mcp/api test
pnpm --filter @super-mcp/api benchmark:fast-basket
```

Expected: all tests pass and benchmark JSON satisfies every gate.

- [ ] **Step 8: Commit performance gates**

```bash
git add services/api/src/scripts/benchmarkFastBasket.ts services/api/src/scripts/canaryBasket.ts services/api/src/scripts/canaryGeocode.ts services/api/package.json .github/workflows/ci.yml services/api/src/services/basket/optimize.ts services/api/src/analytics/metadata.ts services/api/tests/services/basket/fastBasketGolden.test.ts
git commit -m "test(basket): enforce one-call latency and quality budgets"
```

---

### Task 10: End-to-end rollout and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/SPEC.md`
- Modify: `docs/operations.md`
- Modify: `services/api/src/scripts/canaryMcpContract.ts`
- Test: all affected workspaces.

**Interfaces:**
- Produces: operator rollout checklist and public examples.

- [ ] **Step 1: Document the default one-call example**

Show a single request with generic query items and `location`, followed by a compact `complete` response. Explain that assumptions are intentional and strict mode is available for exact product control.

- [ ] **Step 2: Document migration behavior**

```text
Old default: strict confirmation when material candidate ambiguity remains.
New default: fast best-effort completion.
Compatibility: set resolution_mode=strict for old behavior.
Deprecated: verbose; use response_detail=debug.
```

- [ ] **Step 3: Update the live MCP contract canary**

Require:

- protocol `basket-optimize-fast-v2`;
- `optimize_basket` registered first;
- `resolution_mode` and `response_detail` in schema;
- title/description contain one-call shopping-list keywords;
- legacy `prepare_basket` absent.

- [ ] **Step 4: Run the full repository verification**

```bash
pnpm build
pnpm -r run typecheck
pnpm -r run test
pnpm --filter @super-mcp/api canary:mcp-contract
```

Expected: PASS.

- [ ] **Step 5: Run live smoke tests after deployment**

```bash
CANARY_BASKET_LOCATION="רחוב בן גוריון, תל אביב" \
  pnpm --filter @super-mcp/api canary:basket

pnpm --filter @super-mcp/api canary:geocode
```

Expected:

- one initial basket call;
- `status: "complete"`;
- city fallback warning, no geocoding error;
- no product-search recovery;
- no out-of-radius recommendations;
- response under 15 KB;
- warm elapsed time at or below 3 seconds.

- [ ] **Step 6: Commit documentation and rollout checks**

```bash
git add README.md docs/SPEC.md docs/operations.md services/api/src/scripts/canaryMcpContract.ts
git commit -m "docs(basket): document fast one-call workflow"
```

---

## Delivery Order and Review Gates

1. **Tasks 1–3:** Contract and location fast path. Review before changing selection behavior.
2. **Tasks 4–5:** Candidate safety and fast resolution. Review golden outputs line by line.
3. **Task 6:** Locality and pricing honesty. Review recommendation totals and coverage.
4. **Tasks 7–8:** Compact output and MCP routing. Review `tools/list` and sample payloads.
5. **Tasks 9–10:** Performance gates, canaries, and rollout.

Do not optimize SQL or add caches before Task 9 identifies a measured server-side bottleneck. The primary latency win is eliminating agent roundtrips and blocking geocoding, not speculative database tuning.

## Definition of Done

- The supplied Hebrew Tel Aviv request is discoverable and answered with one `optimize_basket` tool call.
- The default result is `complete`, compact, and clearly labeled best-effort.
- Tomatoes and potatoes resolve only to fresh produce for weighted requests.
- Oil never resolves to bath/personal-care products.
- Twelve-egg requests never resolve to six-packs.
- Generic milk does not select flavored/lactose-free variants unless explicitly requested or no safe regular option exists.
- Requested physical quantities survive candidate substitution and pricing.
- No known out-of-radius store appears in recommendations.
- Partial totals are explicitly scoped to priced lines.
- Strict mode still returns validated resumable questions.
- Warm p95 is at most 3 seconds and summary p95 is at most 15 KB.
- Unit, integration, contract, canary, typecheck, and build verification all pass.

