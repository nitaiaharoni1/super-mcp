# Resumable Basket Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile prepare/reconstruct/optimize basket flow with a resumable optimizer that preserves intent, calculates quantities from persisted pack facts, reports real option availability, and returns unambiguous store plans.

**Architecture:** `optimize_basket` becomes a two-state protocol. Initial requests resolve the list and either return a final plan or a signed continuation plus questions; resume requests validate answers from that continuation and finish pricing without requiring callers to reconstruct items. Quantity conversion remains centralized in `resolvePurchaseQty`, while intent, representative SKU, and priceable equivalents remain separate throughout resolution and pricing.

**Tech Stack:** TypeScript 7, Node.js 22 `crypto`, Zod 3, Fastify 5, MCP SDK, PostgreSQL through `@super-mcp/db`, Vitest 3, pnpm workspaces.

## Global Constraints

- Breaking basket API changes are allowed; there are no active users.
- Remove public `prepare_basket`, `POST /v1/basket/prepare`, and the deprecated `qty` input.
- Initial items have exactly one identifier source and exactly one quantity source.
- Resume requests carry only `continuation` plus validated answers.
- Continuations are stateless HMAC-SHA256 tokens, expire after 30 minutes, and require `BASKET_CONTINUATION_SECRET` of at least 32 bytes.
- Persisted/listing pack facts outrank product-size fallbacks; no product-specific hardcoding.
- Vector-only evidence never authorizes resolution or equivalence.
- No final recommendation fields may appear while required questions remain.
- All switch statements over unions use an exhaustive `never` default.
- Imports stay at module top level.
- Do not add runtime dependencies.

---

## File Structure

### New files

- `services/api/src/services/basket/continuation.ts` — encode, authenticate, decode, expire, and validate basket continuations.
- `services/api/src/services/basket/questionAvailability.ts` — batch availability facts and build correctly ordered questions.
- `services/api/src/services/basket/recommendationPlans.ts` — construct the three final recommendation plans with explicit coverage.
- `services/api/tests/services/basket/continuation.test.ts` — continuation security and validation.
- `services/api/tests/services/basket/resumableOptimize.test.ts` — initial/resume state-machine integration tests.
- `services/api/tests/services/basket/resumableBbqGolden.test.ts` — deterministic 18-line regression fixture.
- `services/api/src/scripts/canaryBasket.ts` — opt-in live Herzliya timing/coverage canary.

### Focused modifications

- `packages/shared/src/utils/units.ts` — accept persisted `pieceCount`.
- `packages/shared/tests/utils/units.test.ts` — multipack quantity regressions.
- `services/api/src/services/products/types.ts`, `mapProduct.ts` — expose product `pieceCount`.
- `services/api/src/services/search/types.ts`, `lexicalSql.ts`, `scoredSearch.ts`, `exactProductSearch.ts`, `vectorSearch.ts` — carry `piece_count` into search hits.
- `services/api/src/services/basket/types.ts` — replace legacy request/result types with resumable protocol types and intent modes.
- `services/api/src/services/basket/resolve.ts`, `rankQueryCandidates.ts`, `candidates.ts` — propagate product pack facts and intent overrides.
- `services/api/src/services/basket/intentProfile.ts`, `commodityCoverage.ts` — preserve confirmed commodity intent while pinning exact intent.
- `services/api/src/services/basket/loadPricingData.ts` — load batch availability facts.
- `services/api/src/services/basket/prepare.ts` — retain only internal question helpers, then rename/remove after callers migrate.
- `services/api/src/services/basket/priceStoreBasket.ts`, `substitutions.ts`, `recommendStores.ts`, `optimize.ts` — final pricing and response state machine.
- `services/api/src/services/basket/index.ts` — export only the new public service contract.
- `services/api/src/mcp/tools/basket/index.ts`, `services/api/src/mcp/server.ts` — expose one resumable tool.
- `services/api/src/routes/basket/schemas.ts`, `services/api/src/routes/basket/index.ts` — expose one REST endpoint.
- `services/api/src/openapi/basket.ts` — replace old request/response components and remove prepare path.
- `services/api/src/app.ts` — fail startup on invalid continuation secret.
- `services/api/package.json` — register the canary script.
- `services/api/tests/routes/basket.test.ts` — new REST contract.
- `docs/HOW-IT-WORKS.md`, `README.md` — document only the new flow.

---

### Task 1: Make persisted piece count part of quantity truth

**Files:**
- Modify: `packages/shared/src/utils/units.ts`
- Modify: `packages/shared/tests/utils/units.test.ts`
- Modify: `services/api/src/services/products/types.ts`
- Modify: `services/api/src/services/products/mapProduct.ts`
- Modify: `services/api/src/services/search/types.ts`
- Modify: `services/api/src/services/search/lexicalSql.ts`
- Modify: `services/api/src/services/search/scoredSearch.ts`
- Modify: `services/api/src/services/search/exactProductSearch.ts`
- Modify: `services/api/src/services/search/vectorSearch.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/src/services/basket/candidates.ts`
- Modify: `services/api/src/services/basket/resolve.ts`
- Modify: `services/api/src/services/basket/rankQueryCandidates.ts`
- Modify: `services/api/src/services/basket/priceStoreBasket.ts`
- Test: `services/api/tests/services/basket/priceStoreBasket.test.ts`

**Interfaces:**
- Produces: `resolvePurchaseQty(input: PurchaseQuantityInput): PurchaseQuantity`
- Produces: `ProductSummary.pieceCount: number | null`
- Produces: `BasketCandidate.pieceCount: number | null`
- Consumes: existing `product.piece_count` and `listing.piece_count`

- [ ] **Step 1: Add failing shared quantity tests**

Append to `packages/shared/tests/utils/units.test.ts`:

```ts
it("uses persisted pieceCount when a gram-sized multipack has no count in its name", () => {
  expect(
    resolvePurchaseQty({
      amount: 20,
      unit: "יח",
      productSizeQty: 1000,
      productSizeUnit: "g",
      productName: "פיתות ביתי דגנית",
      pieceCount: 10,
    }),
  ).toEqual({ qty: 2, mode: "packs" });
});

it("prefers an explicit name count over conflicting persisted pieceCount", () => {
  expect(
    resolvePurchaseQty({
      amount: 20,
      unit: "יח",
      productName: "פיתות 8 יח",
      pieceCount: 10,
    }),
  ).toEqual({ qty: 3, mode: "packs" });
});
```

- [ ] **Step 2: Run the shared test and verify failure**

Run:

```bash
pnpm --filter @super-mcp/shared test -- units.test.ts
```

Expected: FAIL because `pieceCount` is not accepted and the first result is 20 units.

- [ ] **Step 3: Extend the single quantity authority**

In `packages/shared/src/utils/units.ts`, introduce exported types and use persisted count after name inference:

```ts
export interface PurchaseQuantityInput {
  packQty?: number;
  amount?: number;
  unit?: string;
  productSizeQty?: number | null;
  productSizeUnit?: string | null;
  productName?: string | null;
  pieceCount?: number | null;
  isWeighted?: boolean;
  saleBasis?: string | null;
}

export interface PurchaseQuantity {
  qty: number;
  mode: "packs" | "weighted_kg_or_l" | "units";
}

export function resolvePurchaseQty(input: PurchaseQuantityInput): PurchaseQuantity {
  // Keep existing validation and non-count paths.
  // In the `need.unit === "unit"` branch:
  const inferredUnitPack =
    inferredPack &&
    !inferredPack.unparseable &&
    inferredPack.unit === "unit" &&
    inferredPack.quantity > 1
      ? inferredPack.quantity
      : null;
  const persistedUnitPack =
    input.pieceCount != null && Number.isFinite(input.pieceCount) && input.pieceCount > 1
      ? input.pieceCount
      : null;
  const dbUnitPack =
    dbPack && !dbPack.unparseable && dbPack.unit === "unit" && dbPack.quantity > 1
      ? dbPack.quantity
      : null;
  const piecesPerPack = inferredUnitPack ?? persistedUnitPack ?? dbUnitPack;
  if (piecesPerPack != null) {
    return {
      qty: Math.max(1, Math.ceil(need.quantity / piecesPerPack)),
      mode: "packs",
    };
  }
  // Preserve existing produce and units fallbacks.
}
```

Keep the rest of the function unchanged; do not duplicate quantity math elsewhere.

- [ ] **Step 4: Run shared tests**

Run:

```bash
pnpm --filter @super-mcp/shared test -- units.test.ts
```

Expected: PASS.

- [ ] **Step 5: Propagate product piece count through product/search types**

Make these exact shape changes:

```ts
// services/api/src/services/products/types.ts
// Add to ProductSummary:
pieceCount: number | null;

// Add to ProductRow:
piece_count: number | null;

// services/api/src/services/search/types.ts
// Add to SearchHitRow:
piece_count: number | null;
```

Update `mapProduct` to map `piece_count → pieceCount`. Add `p.piece_count` to every product SELECT used by lexical, exact, and vector search. Ensure `mapSearchHitRow` returns the mapped value through `mapProduct`.

- [ ] **Step 6: Propagate piece count through basket candidates**

Add:

```ts
// Add to BasketCandidate:
pieceCount: number | null;
```

Update `hitToCandidate`, all candidate factories, `fallbackCandidate`, and test fixtures to supply `pieceCount`. Use `null` where facts are unavailable.

Extend `resolve.ts` direct lookup:

```sql
SELECT id, name, size_qty, size_unit, piece_count
FROM product
WHERE id = ANY($1::uuid[])
```

Pass `pieceCount` in every `resolvePurchaseQty` call in `resolve.ts` and `rankQueryCandidates.ts`.

- [ ] **Step 7: Add a failing listing-precedence pricing test**

In `priceStoreBasket.test.ts`, create a primary candidate with `pieceCount: 8`, a listing with `piece_count: 10`, and request `amount: 20, unit: "יח"`. Assert:

```ts
expect(result?.lines[0]).toMatchObject({
  qty: 2,
  qtyMode: "packs",
  lineTotal: 20,
});
```

Use a unit price of `10`.

- [ ] **Step 8: Pass listing piece count at final pricing**

In `priceStoreBasket.ts`:

```ts
const purchase = resolvePurchaseQty({
  packQty: item.amount == null ? item.qty : undefined,
  amount: item.amount ?? undefined,
  unit: item.unit ?? undefined,
  productSizeQty: candidate.sizeQty,
  productSizeUnit: candidate.sizeUnit,
  productName: candidate.name || listing.name,
  pieceCount: listing.piece_count ?? candidate.pieceCount,
  isWeighted: listing.is_weighted ?? undefined,
  saleBasis: listing.sale_basis ?? undefined,
});
```

- [ ] **Step 9: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @super-mcp/shared test -- units.test.ts
pnpm --filter @super-mcp/shared build
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/priceStoreBasket.test.ts
pnpm --filter @super-mcp/api typecheck
```

Expected: all PASS.

- [ ] **Step 10: Commit the quantity slice**

```bash
git add packages/shared/src/utils/units.ts packages/shared/tests/utils/units.test.ts services/api/src/services/products services/api/src/services/search services/api/src/services/basket services/api/tests/services/basket/priceStoreBasket.test.ts
git commit -m "fix(basket): price multipacks from persisted piece counts"
```

---

### Task 2: Define the new resumable contract and signed continuation

**Files:**
- Create: `services/api/src/services/basket/continuation.ts`
- Create: `services/api/tests/services/basket/continuation.test.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/src/services/basket/resolve.ts`
- Modify: `services/api/src/services/basket/rankQueryCandidates.ts`
- Modify: `services/api/src/services/basket/priceStoreBasket.ts`
- Modify: basket test fixtures under `services/api/tests/services/basket/`
- Modify: `services/api/src/app.ts`

**Interfaces:**
- Produces: `BasketInitialInput`, `BasketResumeInput`, `BasketOptimizeRequest`
- Produces: `BasketContinuationV1`, `BasketAnswer`, `BasketSelectionEffect`
- Produces: `encodeBasketContinuation(payload, secret)`
- Produces: `decodeBasketContinuation(encoded, secret, now?)`

- [ ] **Step 1: Add protocol types**

Replace public prepare/legacy optimize input types in `types.ts` with:

```ts
export type BasketSelectionEffect = "representative" | "pin";
export type BasketIntentMode = "exact" | "commodity" | "needs_confirmation" | "unresolved";

export interface BasketItemInput {
  productId?: string;
  gtin?: string;
  query?: string;
  packQty?: number;
  amount?: number;
  unit?: string;
  /** Internal only; never accepted from the public initial schema. */
  intentModeOverride?: Extract<BasketIntentMode, "exact" | "commodity">;
}

export interface BasketInitialInput extends BasketLocationInput {
  items: BasketItemInput[];
  includeClub?: boolean;
  storesLimit?: number;
  distancePenaltyPerKm?: number;
  verbose?: boolean;
}

export interface BasketAnswer {
  itemIndex: number;
  productId: string;
}

export interface BasketResumeInput {
  continuation: string;
  answers: BasketAnswer[];
}

export type BasketOptimizeRequest = BasketInitialInput | BasketResumeInput;

export interface BasketContinuationQuestion {
  itemIndex: number;
  selectionEffect: BasketSelectionEffect;
  allowedProductIds: string[];
}

export interface BasketContinuationV1 {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  input: BasketInitialInput;
  questions: BasketContinuationQuestion[];
}
```

Remove `BasketPrepareInput`. Keep internal resolved/status types until Task 7 removes unused exports.

- [ ] **Step 2: Rename the internal requested pack-count field**

Replace `BasketItemInput.qty` with `BasketItemInput.packQty`. Update only request-side references:

```ts
// Direct/query quantity conversion
packQty: item.packQty,

// Final listing-specific conversion
packQty: item.amount == null ? item.packQty : undefined,
```

Do not rename `ResolvedItem.qty`, `BasketItemStatus.qty`, or `BasketLine.qty`; those fields represent the calculated shelf quantity, not input pack count. Update all basket test inputs from `{ qty: n }` to `{ packQty: n }`.

- [ ] **Step 3: Write failing continuation tests**

Create `continuation.test.ts` with fixed `SECRET = "test-only-basket-continuation-secret-ok"` and payload timestamps:

```ts
it("round-trips an authenticated continuation", () => {
  const encoded = encodeBasketContinuation(PAYLOAD, SECRET);
  expect(decodeBasketContinuation(encoded, SECRET, 1_001)).toEqual(PAYLOAD);
});

it("rejects tampering", () => {
  const encoded = encodeBasketContinuation(PAYLOAD, SECRET);
  const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("a") ? "b" : "a"}`;
  expect(() => decodeBasketContinuation(tampered, SECRET, 1_001)).toThrow(/invalid continuation/i);
});

it("rejects expiry and unsupported versions", () => {
  const encoded = encodeBasketContinuation(PAYLOAD, SECRET);
  expect(() => decodeBasketContinuation(encoded, SECRET, PAYLOAD.expiresAt + 1)).toThrow(/expired/i);
  const unsupported = encodeBasketContinuation(
    { ...PAYLOAD, version: 2 as never },
    SECRET,
  );
  expect(() => decodeBasketContinuation(unsupported, SECRET, 1_001)).toThrow(
    /unsupported.*version/i,
  );
});

it("requires at least 32 secret bytes", () => {
  expect(() => assertBasketContinuationSecret("short")).toThrow(/32 bytes/i);
});
```

- [ ] **Step 4: Run and verify failure**

Run:

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/continuation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement continuation codec**

Create `continuation.ts` using top-level imports:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@super-mcp/shared";
import type { BasketContinuationV1 } from "./types.js";

const TOKEN_TTL_MS = 30 * 60 * 1000;

export function assertBasketContinuationSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BASKET_CONTINUATION_SECRET must contain at least 32 bytes");
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createBasketContinuationPayload(
  input: BasketContinuationV1["input"],
  questions: BasketContinuationV1["questions"],
  now = Date.now(),
): BasketContinuationV1 {
  return { version: 1, issuedAt: now, expiresAt: now + TOKEN_TTL_MS, input, questions };
}

export function encodeBasketContinuation(
  payload: BasketContinuationV1,
  secret: string,
): string {
  assertBasketContinuationSecret(secret);
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = signature(body, secret).toString("base64url");
  return `${body}.${mac}`;
}

export function decodeBasketContinuation(
  token: string,
  secret: string,
  now = Date.now(),
): BasketContinuationV1 {
  assertBasketContinuationSecret(secret);
  const [body, suppliedMac, extra] = token.split(".");
  if (!body || !suppliedMac || extra) {
    throw new AppError("invalid_basket_continuation", "invalid basket continuation", 400);
  }
  const expected = signature(body, secret);
  const supplied = Buffer.from(suppliedMac, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new AppError("invalid_basket_continuation", "invalid basket continuation", 400);
  }
  let parsed: BasketContinuationV1;
  try {
    parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as BasketContinuationV1;
  } catch {
    throw new AppError("invalid_basket_continuation", "invalid basket continuation", 400);
  }
  if (parsed.version !== 1) {
    throw new AppError(
      "unsupported_basket_continuation",
      "unsupported basket continuation version",
      400,
    );
  }
  if (parsed.expiresAt < now) {
    throw new AppError("basket_continuation_expired", "basket continuation expired", 400);
  }
  return parsed;
}
```

Catch malformed JSON and convert it to the same `invalid basket continuation` `AppError`.

- [ ] **Step 6: Validate production configuration at startup**

In `app.ts`, import `assertBasketContinuationSecret` and call:

```ts
assertBasketContinuationSecret(process.env.BASKET_CONTINUATION_SECRET ?? "");
```

Place it at the start of `buildApp`. In tests that call `buildApp`, set a fixed secret in test setup. Route-only unit tests that register routes directly pass a codec/secret as described in Task 7 rather than relying on environment state.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/continuation.test.ts
pnpm --filter @super-mcp/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the protocol foundation**

```bash
git add services/api/src/services/basket/continuation.ts services/api/src/services/basket/types.ts services/api/src/app.ts services/api/tests/services/basket/continuation.test.ts
git commit -m "feat(basket): add authenticated resumable basket context"
```

---

### Task 3: Unify availability facts and confirmation questions

**Files:**
- Create: `services/api/src/services/basket/questionAvailability.ts`
- Modify: `services/api/src/services/basket/loadPricingData.ts`
- Modify: `services/api/src/services/basket/prepare.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/tests/services/basket/prepareBasket.test.ts`
- Create: `services/api/tests/services/basket/questionAvailability.test.ts`

**Interfaces:**
- Produces: `CandidateAvailability`
- Produces: `loadCandidateAvailability(productIds, storeIds)`
- Produces: `buildBasketQuestions(inputItems, statuses, availability, limit)`
- Consumes: `BasketCandidate`, `BasketItemStatus`

- [ ] **Step 1: Define richer availability and question shapes**

Add to `types.ts`:

```ts
export interface CandidateAvailability {
  pricedStoreCount: number;
  chainCount: number;
  minPrice: number | null;
}

export interface BasketQuestionOption {
  productId: string;
  name: string;
  pack: {
    pieceCount: number | null;
    sizeQty: number | null;
    sizeUnit: string | null;
  };
  nearbyPricedStores: number;
  nearbyPricedChains: number;
  minimumNearbyPrice: number | null;
}

export interface BasketQuestion {
  itemIndex: number;
  id: string;
  prompt: string;
  reason: string;
  required: true;
  selectionEffect: BasketSelectionEffect;
  options: BasketQuestionOption[];
}
```

- [ ] **Step 2: Write failing availability tests**

Create `questionAvailability.test.ts`:

```ts
// AMBIGUOUS_STATUS contains candidates local-wide, local-narrow, and unavailable;
// local-wide has pieceCount: 10.
it("orders safe local options by availability, chain diversity, price, then score", () => {
  const questions = buildBasketQuestions(
    [{ query: "פיתות", amount: 20, unit: "יח" }],
    [AMBIGUOUS_STATUS],
    new Map([
      ["local-wide", { pricedStoreCount: 5, chainCount: 3, minPrice: 12 }],
      ["local-narrow", { pricedStoreCount: 2, chainCount: 1, minPrice: 9 }],
      ["unavailable", { pricedStoreCount: 0, chainCount: 0, minPrice: null }],
    ]),
    3,
  );
  expect(questions[0]?.options.map((option) => option.productId)).toEqual([
    "local-wide",
    "local-narrow",
    "unavailable",
  ]);
  expect(questions[0]?.options[0]?.pack.pieceCount).toBe(10);
});
```

- [ ] **Step 3: Replace count-only SQL with one batch availability query**

In `loadPricingData.ts`, add:

```ts
export async function loadCandidateAvailability(
  productIds: string[],
  storeIds: string[],
): Promise<Map<string, CandidateAvailability>> {
  if (productIds.length === 0 || storeIds.length === 0) return new Map();
  const result = await query<{
    product_id: string;
    priced_stores: string | number;
    priced_chains: string | number;
    min_price: string | number | null;
  }>(
    `SELECT l.product_id,
            count(DISTINCT sp.store_id) AS priced_stores,
            count(DISTINCT l.chain_id) AS priced_chains,
            min(sp.price) AS min_price
       FROM listing l
       JOIN store_price sp ON sp.listing_id = l.id
      WHERE l.product_id = ANY($1::uuid[])
        AND sp.store_id = ANY($2::uuid[])
        AND sp.price > 0
      GROUP BY l.product_id`,
    [productIds, storeIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.product_id,
      {
        pricedStoreCount: Number(row.priced_stores),
        chainCount: Number(row.priced_chains),
        minPrice: row.min_price == null ? null : Number(row.min_price),
      },
    ]),
  );
}
```

Remove `countNearbyPricedStores` after all callers migrate.

- [ ] **Step 4: Implement the shared question builder**

Move shortlist/question logic from `prepare.ts` to `questionAvailability.ts`. The comparator must be:

```ts
function compareQuestionCandidates(
  a: BasketCandidate,
  b: BasketCandidate,
  availability: Map<string, CandidateAvailability>,
): number {
  const aAvailability = availability.get(a.productId) ?? EMPTY_AVAILABILITY;
  const bAvailability = availability.get(b.productId) ?? EMPTY_AVAILABILITY;
  return (
    prepareIntentTierRank(a.intentTier) - prepareIntentTierRank(b.intentTier) ||
    Number(bAvailability.pricedStoreCount > 0) - Number(aAvailability.pricedStoreCount > 0) ||
    bAvailability.chainCount - aAvailability.chainCount ||
    (aAvailability.minPrice ?? Number.POSITIVE_INFINITY) -
      (bAvailability.minPrice ?? Number.POSITIVE_INFINITY) ||
    b.score - a.score ||
    a.productId.localeCompare(b.productId)
  );
}
```

Apply `queryHeadAnchored` as a stable safety partition before this comparator. Derive `selectionEffect` with an exhaustive switch over `LineRisk`:

```ts
function selectionEffectForRisk(risk: LineRisk): BasketSelectionEffect {
  switch (risk.kind) {
    case "commodity":
      return "representative";
    case "brand_pinned":
    case "cross_class":
    case "opaque":
      return "pin";
    default: {
      const exhaustive: never = risk;
      return exhaustive;
    }
  }
}
```

- [ ] **Step 5: Migrate prepare internals and tests**

Make `prepare.ts` a thin internal helper that calls `loadCandidateAvailability` and `buildBasketQuestions`. Update mocks and assertions in `prepareBasket.test.ts` to the richer shape. Do not change the public tool yet; Task 7 removes it after the new optimizer is complete.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/questionAvailability.test.ts tests/services/basket/prepareBasket.test.ts
pnpm --filter @super-mcp/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit availability unification**

```bash
git add services/api/src/services/basket/questionAvailability.ts services/api/src/services/basket/loadPricingData.ts services/api/src/services/basket/prepare.ts services/api/src/services/basket/types.ts services/api/tests/services/basket
git commit -m "fix(basket): use real local availability in confirmations"
```

---

### Task 4: Preserve intent when applying confirmation answers

**Files:**
- Modify: `services/api/src/services/basket/intentProfile.ts`
- Modify: `services/api/src/services/basket/commodityCoverage.ts`
- Modify: `services/api/src/services/basket/lineRisk.ts`
- Modify: `services/api/src/services/basket/resolve.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/tests/services/basket/intentProfile.test.ts`
- Modify: `services/api/tests/services/basket/commodityCoverage.test.ts`
- Modify: `services/api/tests/services/basket/productIdCoverage.test.ts`

**Interfaces:**
- Produces: `applyBasketAnswers(payload, answers): BasketInitialInput`
- Produces: `BasketIntentProfile.mode`
- Consumes: continuation questions and original initial input

- [ ] **Step 1: Write failing answer-validation and intent tests**

Add tests covering:

```ts
it("applies a representative answer without dropping the original query", () => {
  const resumed = applyBasketAnswers(PAYLOAD, [{ itemIndex: 3, productId: "pita-10" }]);
  expect(resumed.items[3]).toMatchObject({
    productId: "pita-10",
    query: "פיתות",
    amount: 20,
    unit: "יח",
    intentModeOverride: "commodity",
  });
});

it("applies a pin answer as exact intent", () => {
  const resumed = applyBasketAnswers(PIN_PAYLOAD, [{ itemIndex: 0, productId: "coke-zero" }]);
  expect(resumed.items[0]?.intentModeOverride).toBe("exact");
});

it("rejects missing, duplicate, unknown, and unoffered answers", () => {
  expect(() => applyBasketAnswers(PAYLOAD, [])).toThrow(/missing required answer/i);
  expect(() => applyBasketAnswers(PAYLOAD, DUPLICATES)).toThrow(/duplicate answer/i);
  expect(() => applyBasketAnswers(PAYLOAD, UNKNOWN)).toThrow(/unknown item index/i);
  expect(() => applyBasketAnswers(PAYLOAD, UNOFFERED)).toThrow(/not offered/i);
});
```

- [ ] **Step 2: Implement answer application in `continuation.ts`**

Add:

```ts
export function applyBasketAnswers(
  payload: BasketContinuationV1,
  answers: BasketAnswer[],
): BasketInitialInput {
  const answersByIndex = new Map<number, BasketAnswer>();
  for (const answer of answers) {
    if (answersByIndex.has(answer.itemIndex)) {
      throw new AppError(
        "invalid_basket_answer",
        `duplicate answer for item ${answer.itemIndex}`,
        400,
      );
    }
    answersByIndex.set(answer.itemIndex, answer);
  }
  for (const question of payload.questions) {
    const answer = answersByIndex.get(question.itemIndex);
    if (!answer) {
      throw new AppError(
        "missing_basket_answer",
        `missing required answer for item ${question.itemIndex}`,
        400,
      );
    }
    if (!question.allowedProductIds.includes(answer.productId)) {
      throw new AppError(
        "invalid_basket_answer",
        `product was not offered for item ${question.itemIndex}`,
        400,
      );
    }
  }
  if (answersByIndex.size !== payload.questions.length) {
    throw new AppError(
      "invalid_basket_answer",
      "answer references an unknown item index",
      400,
    );
  }
  const questionByIndex = new Map(payload.questions.map((question) => [question.itemIndex, question]));
  return {
    ...payload.input,
    items: payload.input.items.map((item, itemIndex) => {
      const question = questionByIndex.get(itemIndex);
      const answer = answersByIndex.get(itemIndex);
      if (!question || !answer) return item;
      return {
        ...item,
        productId: answer.productId,
        gtin: undefined,
        intentModeOverride: question.selectionEffect === "pin" ? "exact" : "commodity",
      };
    }),
  };
}
```

Internal resumed items may contain both `productId` and the preserved `query`; public initial validation still rejects multiple identifier sources.

- [ ] **Step 3: Make intent mode explicit**

Extend `BasketIntentProfile`:

```ts
export interface BasketIntentProfile {
  mode: Extract<BasketIntentMode, "exact" | "commodity">;
  queryText: string;
  hasFreeTextQuery: boolean;
  requestedCanonUnit: CanonicalUnit | null;
  allowCountToWeight: boolean;
}
```

In `buildBasketIntentProfile`, prefer `item.intentModeOverride`. Otherwise:

- GTIN or product ID without query → exact.
- brand/variant-pinned query from `classifyLineRisk` → exact.
- safe generic classified query → commodity.

- [ ] **Step 4: Replace the binary free-text coverage gate**

In `commodityCoverage.ts`, replace:

```ts
if (!intent.hasFreeTextQuery) return;
```

with:

```ts
if (intent.mode === "exact") return;
const queryText = intent.queryText;
const peers = filterClassPeers(queryText, primary, rows, {
  requireQueryTokens: true,
  allowCountToWeight: intent.allowCountToWeight,
});
```

Because resumed representative items preserve the query, query-token safety remains active. Do not broaden product-ID-only initial requests.

- [ ] **Step 5: Add equivalence safety regressions**

Assert:

- confirmed generic pita/onion keeps peers across at least two chains;
- Taster's Choice pin gets no coffee-class peers;
- Coke Zero pin never gets regular Coke;
- representative selection retains `queryHeadAnchored` and variant gates.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/continuation.test.ts tests/services/basket/intentProfile.test.ts tests/services/basket/commodityCoverage.test.ts tests/services/basket/productIdCoverage.test.ts
pnpm --filter @super-mcp/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit intent-preserving resume**

```bash
git add services/api/src/services/basket services/api/tests/services/basket
git commit -m "feat(basket): preserve commodity intent across confirmation"
```

---

### Task 5: Replace ambiguous recommendation semantics

**Files:**
- Create: `services/api/src/services/basket/recommendationPlans.ts`
- Modify: `services/api/src/services/basket/recommendStores.ts`
- Modify: `services/api/src/services/basket/priceStoreBasket.ts`
- Modify: `services/api/src/services/basket/substitutions.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Modify: `services/api/tests/services/basket/recommendStores.test.ts`
- Modify: `services/api/tests/services/basket/priceStoreBasket.test.ts`

**Interfaces:**
- Produces: `BasketStorePlan`, `BasketMultiStorePlan`
- Produces: `pickBestSingleStore`, `pickCheapestCompleteStore`
- Produces: `buildRecommendationPlans`

- [ ] **Step 1: Replace result interfaces**

Add:

```ts
export interface BasketCoverage {
  pricedLines: number;
  resolvableLines: number;
  requestedLines: number;
  coverageRatio: number;
}

export interface BasketStorePlan extends BasketCoverage {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  total: number;
  currency: string;
  distanceKm: number | null;
  lines: BasketLine[];
  missingItems: BasketMissingItem[];
}

export interface BasketMultiStorePlan extends BasketCoverage {
  total: number;
  currency: string;
  storeCount: number;
  lines: MultiStoreLine[];
  missingItemIndexes: number[];
}
```

Remove `BasketRecommendation`, `BasketRecommendations`, and old `MultiStorePlan`.

- [ ] **Step 2: Write failing ranking tests**

Replace old recommendation tests with:

```ts
it("bestSingleStore maximizes coverage before effective cost", () => {
  expect(pickBestSingleStore([
    store("cheap-partial", 13, 200, 1),
    store("fuller", 16, 390, 2),
  ], OPTIONS)?.storeName).toBe("fuller");
});

it("uses effective cost only inside the one-line max-coverage band", () => {
  expect(pickBestSingleStore([
    store("sixteen", 16, 410, 3),
    store("fifteen", 15, 380, 1),
  ], OPTIONS)?.storeName).toBe("fifteen");
});

it("cheapestCompleteStore is null unless a store prices every resolvable line", () => {
  expect(pickCheapestCompleteStore([store("partial", 15, 300, 1)], 16)).toBeNull();
});

it("tie-breaks deterministically by store id", () => {
  expect(pickBestSingleStore([
    store("b", 16, 400, 1),
    store("a", 16, 400, 1),
  ], OPTIONS)?.storeId).toBe("a");
});
```

- [ ] **Step 3: Implement focused pickers**

In `recommendStores.ts`, remove `COVERAGE_FRACTION`, `cheapest`, `bestNearby`, `bestInStore`, and `bestOrderable`. Export:

```ts
export function pickBestSingleStore(
  stores: BasketStoreResult[],
  opts: RecommendationOptions,
): BasketStoreResult | null {
  if (stores.length === 0) return null;
  const maxCoverage = Math.max(...stores.map((store) => store.lines.length));
  const eligible = stores.filter((store) => store.lines.length >= maxCoverage - 1);
  return [...eligible].sort((a, b) =>
    effectiveCost(a, opts) - effectiveCost(b, opts) ||
    b.lines.length - a.lines.length ||
    a.storeId.localeCompare(b.storeId)
  )[0] ?? null;
}

export function pickCheapestCompleteStore(
  stores: BasketStoreResult[],
  resolvableLines: number,
): BasketStoreResult | null {
  return [...stores]
    .filter((store) => store.lines.length === resolvableLines)
    .sort((a, b) =>
      a.total - b.total ||
      (a.distanceKm ?? Number.POSITIVE_INFINITY) -
        (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
      a.storeId.localeCompare(b.storeId)
    )[0] ?? null;
}
```

- [ ] **Step 4: Implement coverage-aware plan builders**

Create `recommendationPlans.ts`:

```ts
function coverage(
  pricedLines: number,
  resolvableLines: number,
  requestedLines: number,
): BasketCoverage {
  return {
    pricedLines,
    resolvableLines,
    requestedLines,
    coverageRatio: requestedLines === 0 ? 0 : pricedLines / requestedLines,
  };
}

export function toStorePlan(
  store: BasketStoreResult | null,
  resolvableLines: number,
  requestedLines: number,
): BasketStorePlan | null {
  if (!store) return null;
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    chainId: store.chainId,
    chainName: store.chainName,
    total: store.total,
    currency: store.currency,
    distanceKm: store.distanceKm,
    lines: store.lines,
    missingItems: store.missingItems,
    ...coverage(store.lines.length, resolvableLines, requestedLines),
  };
}
```

Update multi-store construction to use the same coverage helper and return grouped/per-store information already present on lines.

- [ ] **Step 5: Remove old recommendation builders**

Delete `RecommendationKind`, `buildCheapestRecommendation`, and `recommendationReason` from `priceStoreBasket.ts`. Remove `applyCheapestStoreSubstitutions`; if item display needs alignment, introduce `applyStorePlanSubstitutions(statuses, bestSingleStore)` with that exact name.

- [ ] **Step 6: Run recommendation/pricing tests**

Run:

```bash
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/recommendStores.test.ts tests/services/basket/priceStoreBasket.test.ts
pnpm --filter @super-mcp/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit recommendation replacement**

```bash
git add services/api/src/services/basket services/api/tests/services/basket
git commit -m "refactor(basket): replace partial cheapest with explicit plans"
```

---

### Task 6: Implement the resumable optimizer state machine

**Files:**
- Modify: `services/api/src/services/basket/optimize.ts`
- Modify: `services/api/src/services/basket/prepare.ts`
- Modify: `services/api/src/services/basket/index.ts`
- Modify: `services/api/src/services/basket/types.ts`
- Create: `services/api/tests/services/basket/resumableOptimize.test.ts`
- Modify: existing optimize service tests to use the new result union

**Interfaces:**
- Produces: `optimizeBasket(request, options): Promise<BasketOptimizeResult>`
- Produces: discriminated result union with `status`
- Consumes: continuation codec, question builder, pricing plans

- [ ] **Step 1: Define the result union**

In `types.ts`:

```ts
export interface BasketPreview {
  priceScope: "resolved_subset";
  resolvedLines: number;
  requestedLines: number;
  candidateStores: number;
}

export interface BasketNeedsConfirmationResult {
  status: "needs_confirmation";
  continuation: string;
  questions: BasketQuestion[];
  preview: BasketPreview;
  items: BasketItemStatus[];
  location: StoreLocationMetadata;
}

export interface BasketCompleteResult {
  status: "complete";
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
  items: BasketItemStatus[];
  stores: BasketStoreResult[];
  storesCompared: number;
  storesTruncated: boolean;
  location: StoreLocationMetadata;
}

export type BasketOptimizeResult =
  | BasketNeedsConfirmationResult
  | BasketCompleteResult;

export interface BasketOptimizeOptions {
  continuationSecret: string;
  now?: number;
}
```

- [ ] **Step 2: Write failing state-machine tests**

Create `resumableOptimize.test.ts` using the existing resolve/store/pricing mock pattern:

```ts
it("returns complete in one call when no required questions remain", async () => {
  const result = await optimizeBasket(INITIAL_SAFE, OPTIONS);
  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw new Error("expected complete");
  expect(result.bestSingleStore).not.toBeNull();
});

it("returns continuation and no final recommendations when confirmation is required", async () => {
  const result = await optimizeBasket(INITIAL_AMBIGUOUS, OPTIONS);
  expect(result.status).toBe("needs_confirmation");
  if (result.status !== "needs_confirmation") throw new Error("expected confirmation");
  expect(result).not.toHaveProperty("bestSingleStore");
  expect(result).not.toHaveProperty("multiStore");
  expect(result.questions[0]?.options[0]?.nearbyPricedStores).toBeGreaterThan(0);
});

it("resumes using only continuation and answers", async () => {
  const first = await optimizeBasket(INITIAL_AMBIGUOUS, OPTIONS);
  if (first.status !== "needs_confirmation") throw new Error("expected confirmation");
  const second = await optimizeBasket({
    continuation: first.continuation,
    answers: [{ itemIndex: 0, productId: first.questions[0]!.options[0]!.productId }],
  }, OPTIONS);
  expect(second.status).toBe("complete");
});
```

- [ ] **Step 3: Split initial and resume orchestration**

In `optimize.ts`, use a type guard:

```ts
function isResumeRequest(request: BasketOptimizeRequest): request is BasketResumeInput {
  return "continuation" in request;
}

export async function optimizeBasket(
  request: BasketOptimizeRequest,
  options: BasketOptimizeOptions,
): Promise<BasketOptimizeResult> {
  const input = isResumeRequest(request)
    ? applyBasketAnswers(
        decodeBasketContinuation(
          request.continuation,
          options.continuationSecret,
          options.now,
        ),
        request.answers,
      )
    : request;
  return optimizeInitialOrResumedBasket(input, options);
}
```

- [ ] **Step 4: Return early with a continuation before pricing**

After resolution and batch availability:

```ts
const questions = buildBasketQuestions(input.items, itemStatuses, availability, 3);
if (questions.length > 0) {
  const payload = createBasketContinuationPayload(
    input,
    questions.map((question) => ({
      itemIndex: question.itemIndex,
      selectionEffect: question.selectionEffect,
      allowedProductIds: question.options.map((option) => option.productId),
    })),
    options.now,
  );
  return {
    status: "needs_confirmation",
    continuation: encodeBasketContinuation(payload, options.continuationSecret),
    questions,
    preview: {
      priceScope: "resolved_subset",
      resolvedLines: itemStatuses.filter((item) => item.resolutionStatus === "resolved").length,
      requestedLines: input.items.length,
      candidateStores: candidateStores.length,
    },
    items: serializeQuestionStatuses(itemStatuses),
    location,
  };
}
```

Do not call `loadBasketPricingData` before this return.

- [ ] **Step 5: Build final plans only for complete resolution**

After equivalence enrichment and per-store pricing:

```ts
const resolvableLines = resolvedItems.filter((item) => item.productId != null).length;
const bestSingle = pickBestSingleStore(storeResults, rankingOptions);
const cheapestComplete = pickCheapestCompleteStore(storeResults, resolvableLines);
return {
  status: "complete",
  bestSingleStore: toStorePlan(bestSingle, resolvableLines, input.items.length),
  cheapestCompleteStore: toStorePlan(
    cheapestComplete,
    resolvableLines,
    input.items.length,
  ),
  multiStore: buildMultiStorePlan(
    resolvedItems,
    storeResults,
    input.items.length,
  ),
  items: buildFinalItemStatuses(resolvedItems, bestSingle),
  stores: trimStoreResults(storeResults, input.storesLimit, input.verbose, [
    bestSingle?.storeId,
    cheapestComplete?.storeId,
  ]),
  storesCompared: storeResults.length,
  storesTruncated: storeResults.length > storesLimit,
  location,
};
```

Delete `computeBasketCompleteness`, partial recommendation behavior, old question call sites, and `emptyBasketResult`.

- [ ] **Step 6: Remove the public prepare service**

Move any remaining reusable functions out of `prepare.ts`, delete `prepareBasket`, then delete `prepare.ts` if empty. Update `services/basket/index.ts` to export only:

```ts
export { optimizeBasket } from "./optimize.js";
export type {
  BasketOptimizeRequest,
  BasketOptimizeResult,
  BasketInitialInput,
  BasketResumeInput,
} from "./types.js";
```

- [ ] **Step 7: Migrate existing service tests**

For tests that are still valuable:

- change input `qty` to `packQty` or `amount + unit`;
- narrow on `result.status`;
- assert `preview` for confirmation cases;
- assert plan coverage fields for complete cases.

Delete tests whose only purpose is deprecated `cheapest`, `totalsArePartial`, or public prepare behavior.

- [ ] **Step 8: Run basket service suite**

Run:

```bash
pnpm --filter @super-mcp/shared build
pnpm --filter @super-mcp/api exec vitest run tests/services/basket
pnpm --filter @super-mcp/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit the state machine**

```bash
git add services/api/src/services/basket services/api/tests/services/basket
git commit -m "feat(basket): make optimization resumable"
```

---

### Task 7: Replace MCP, REST, and OpenAPI boundaries

**Files:**
- Modify: `services/api/src/mcp/tools/basket/index.ts`
- Modify: `services/api/src/mcp/server.ts`
- Modify: `services/api/src/routes/basket/schemas.ts`
- Modify: `services/api/src/routes/basket/index.ts`
- Modify: `services/api/src/openapi/basket.ts`
- Modify: `services/api/tests/routes/basket.test.ts`

**Interfaces:**
- Produces: one public `optimize_basket`
- Produces: one REST `POST /v1/basket/optimize`
- Removes: `prepare_basket`, `/v1/basket/prepare`, `qty`

- [ ] **Step 1: Write failing boundary contract tests**

Replace `routes/basket.test.ts` assertions with:

```ts
it("accepts exactly one identifier and one quantity source", () => {
  expect(basketItemSchema.parse({ query: "פיתות", amount: 20, unit: "יח" })).toBeDefined();
  expect(() => basketItemSchema.parse({ query: "פיתות", product_id: UUID, pack_qty: 2 }))
    .toThrow(/exactly one identifier/i);
  expect(() => basketItemSchema.parse({ query: "פיתות", qty: 2 })).toThrow();
});

it("accepts a resume request without items or location", () => {
  expect(basketOptimizeBodySchema.parse({
    continuation: "body.signature",
    answers: [{ item_index: 3, product_id: UUID }],
  })).toBeDefined();
});

it("does not register prepare REST or MCP surfaces", () => {
  expect(basketPaths).not.toHaveProperty("/v1/basket/prepare");
  expect(basketMcpTools).toEqual(["optimize_basket"]);
});
```

- [ ] **Step 2: Replace Zod schemas**

Use strict schemas:

```ts
export const basketItemSchema = z.object({
  product_id: z.string().uuid().optional(),
  gtin: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  pack_qty: z.coerce.number().positive().optional(),
  amount: z.coerce.number().positive().optional(),
  unit: z.string().trim().min(1).optional(),
}).strict()
  .refine((item) =>
    [item.product_id, item.gtin, item.query].filter((value) => value != null).length === 1,
    "each item requires exactly one identifier: product_id, gtin, or query",
  )
  .refine((item) =>
    Number(item.pack_qty != null) + Number(item.amount != null) === 1,
    "each item requires exactly one quantity source: pack_qty or amount + unit",
  )
  .refine((item) => item.amount == null || item.unit != null, "amount requires unit")
  .refine((item) => item.amount != null || item.unit == null, "unit requires amount");

const initialSchema = z.object({
  items: z.array(basketItemSchema).min(1).max(50),
  ...basketLocationBodyShape,
  include_club: z.boolean().optional().default(true),
  stores_limit: z.coerce.number().int().min(0).max(500).optional(),
  distance_penalty_per_km: z.coerce.number().min(0).max(100).optional(),
  verbose: z.coerce.boolean().optional(),
}).strict();

const resumeSchema = z.object({
  continuation: z.string().min(1),
  answers: z.array(z.object({
    item_index: z.number().int().min(0),
    product_id: z.string().uuid(),
  }).strict()).min(1),
}).strict();

export const basketOptimizeBodySchema = z.union([initialSchema, resumeSchema]);
```

The initial branch must additionally require `city` or `near`.

- [ ] **Step 3: Expose one REST route**

Remove `/v1/basket/prepare`. Map initial and resume bodies to the internal union. Pass:

```ts
function mapOptimizeBody(body: z.infer<typeof basketOptimizeBodySchema>): BasketOptimizeRequest {
  if ("continuation" in body) {
    return {
      continuation: body.continuation,
      answers: body.answers.map((answer) => ({
        itemIndex: answer.item_index,
        productId: answer.product_id,
      })),
    };
  }
  return {
    items: body.items.map((item) => ({
      productId: item.product_id,
      gtin: item.gtin,
      query: item.query,
      packQty: item.pack_qty,
      amount: item.amount,
      unit: item.unit,
    })),
    city: body.city,
    near: parseNear(body.near),
    radiusKm: body.radius_km,
    includeClub: body.include_club,
    storesLimit: body.stores_limit,
    distancePenaltyPerKm: body.distance_penalty_per_km,
    verbose: body.verbose,
  };
}

return optimizeBasket(mapOptimizeBody(body), {
  continuationSecret: process.env.BASKET_CONTINUATION_SECRET!,
});
```

to `optimizeBasket`.

- [ ] **Step 4: Expose one MCP tool**

Remove `prepare_basket` registration. Define a union input schema for initial fields versus `continuation + answers`. The tool description must say:

> Call once with the original shopping list. If status is needs_confirmation, ask every returned question and call the same tool once more with only continuation and answers. Never reconstruct items and do not call search_products per line.

Map snake_case only at the boundary.

- [ ] **Step 5: Replace server instructions**

Replace `MCP_SERVER_INSTRUCTIONS` shopping-list section with the two-state protocol. Remove all references to deprecated `qty`, prepare, retaining query manually, and ambiguous cheapest semantics.

- [ ] **Step 6: Replace OpenAPI components and path**

In `openapi/basket.ts`:

- remove prepare request/response schemas and path;
- model initial/resume request with `oneOf`;
- model complete/needs-confirmation response with `oneOf` and required `status`;
- define question pack facts and availability;
- define `bestSingleStore`, `cheapestCompleteStore`, and `multiStore`;
- remove `cheapest`, `recommendations`, `completeness`, and `totalsArePartial`;
- set `basketMcpTools = ["optimize_basket"] as const`.

- [ ] **Step 7: Run route/OpenAPI tests**

Run:

```bash
pnpm --filter @super-mcp/api exec vitest run tests/routes/basket.test.ts
pnpm --filter @super-mcp/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit public contract replacement**

```bash
git add services/api/src/mcp services/api/src/routes/basket services/api/src/openapi/basket.ts services/api/tests/routes/basket.test.ts
git commit -m "feat(api): expose resumable basket optimization"
```

---

### Task 8: Add end-to-end regression, telemetry, canary, and documentation

**Files:**
- Create: `services/api/tests/services/basket/resumableBbqGolden.test.ts`
- Modify: `services/api/src/services/basket/optimize.ts`
- Create: `services/api/src/scripts/canaryBasket.ts`
- Modify: `services/api/package.json`
- Modify: `docs/HOW-IT-WORKS.md`
- Modify: `README.md`
- Delete or replace: `services/api/tests/services/basket/bbqGolden.test.ts`

**Interfaces:**
- Produces: one structured `basket_optimize` log per call
- Produces: `pnpm --filter @super-mcp/api canary:basket`
- Verifies: one/two-call BBQ flow, quantity, safety, coverage, and payload bounds

- [ ] **Step 1: Build the true BBQ golden fixture**

Create the exact 18-item input using `packQty` only for literal shelf packs and `amount + unit` for physical need:

```ts
const BBQ_ITEMS: BasketItemInput[] = [
  { query: "פרגיות", amount: 1.75, unit: "kg" },
  { query: "קבבים", amount: 1.5, unit: "kg" },
  { query: "אנטרקוט", amount: 0.75, unit: "kg" },
  { query: "פיתות", amount: 20, unit: "יח" },
  { query: "חומוס", amount: 1.5, unit: "kg" },
  { query: "טחינה", amount: 0.5, unit: "kg" },
  { query: "מלח גס", packQty: 1 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "פלפל", amount: 3, unit: "יח" },
  { query: "בצל", amount: 3, unit: "יח" },
  { query: "חסה", amount: 1, unit: "יח" },
  { query: "לימון", amount: 4, unit: "יח" },
  { query: "אבטיח", amount: 1, unit: "יח" },
  { query: "קוקה קולה 1.5 ליטר", amount: 2, unit: "יח" },
  { query: "יין", amount: 3, unit: "יח" },
  { query: "טייסטרס צ׳ויס", packQty: 1 },
  { query: "שקית קרח", packQty: 1 },
];
```

Use real `resolveItems`, `rankQueryCandidates`, question building, continuation, equivalence, and pricing functions. Mock only DB/search boundaries with deterministic rows that include:

- pita canonical `1000g` and `piece_count=10`;
- at least two chain-local commodity SKUs;
- regular and Zero Coke as distinguishable variants;
- brand-pinned coffee;
- a valid bag-of-ice candidate plus ice-pop distractors;
- 16-line best store and 18-line multi-store availability.

- [ ] **Step 2: Assert complete protocol and safety gates**

The golden must assert:

```ts
expect([first.status, second?.status]).toEqual(["needs_confirmation", "complete"]);
if (first.status !== "needs_confirmation") throw new Error("expected confirmation");
expect(first.questions.length).toBeGreaterThan(0);
expect(first.questions.length).toBeLessThanOrEqual(3);

if (!second || second.status !== "complete") throw new Error("expected completion");
expect(second.bestSingleStore?.pricedLines).toBeGreaterThanOrEqual(16);
expect(second.multiStore?.pricedLines).toBe(18);

const pita = second.bestSingleStore?.lines.find((line) => line.itemIndex === 3);
expect(pita).toMatchObject({ qty: 2, qtyMode: "packs" });

expect(JSON.stringify(second)).not.toContain("totalsArePartial");
expect(JSON.stringify(second)).not.toContain("\"cheapest\"");
expect(JSON.stringify(second).length).toBeLessThan(25_000);

const regularCokeLine = second.bestSingleStore?.lines.find(
  (line) => line.itemIndex === 14,
);
expect(regularCokeLine?.name).not.toMatch(/zero|זירו/i);

const pargiyotLine = second.bestSingleStore?.lines.find(
  (line) => line.itemIndex === 0,
);
expect(pargiyotLine?.name).not.toMatch(/עם עצם|ירכיים/i);

const wineQuestion = first.questions.find((question) => question.itemIndex === 15);
const wineLine = second.bestSingleStore?.lines.find((line) => line.itemIndex === 15);
expect(Boolean(wineQuestion) || Boolean(wineLine)).toBe(true);
```

- [ ] **Step 3: Add structured timings without raw user text**

In `optimize.ts`, collect phase timings and emit exactly one event:

```ts
console.log(JSON.stringify({
  event: "basket_optimize",
  protocolState: isResumeRequest(request) ? "resume" : "initial",
  requestedLines: input.items.length,
  resolvedLines,
  confirmedLines,
  unresolvedLines,
  pricedLines,
  questionCount: questions.length,
  candidateStoreCount: candidateStores.length,
  searchMs,
  classificationMs,
  availabilityMs,
  equivalenceMs,
  pricingMs,
  dbQueryCount: null,
  totalMs: Date.now() - startedAt,
  bestSingleStoreCoverage: bestSingleStore?.coverageRatio ?? null,
  continuationBytes: continuation ? Buffer.byteLength(continuation, "utf8") : 0,
}));
```

If existing phase functions do not expose timings, add an internal `BasketPhaseTimings` accumulator passed through orchestration. Keep `dbQueryCount: null` until the database wrapper exposes a request-scoped counter; do not infer a false value. Do not log queries, names, product IDs, answers, or continuation content.

- [ ] **Step 4: Add live canary script**

Create `canaryBasket.ts` that calls `optimizeBasket` with the real list and configured DB. If confirmation is required, print question IDs and options but do not auto-answer. Output only:

- phase timings;
- counts and coverage;
- quantity decisions;
- chain/store names for final plans;
- missing line indexes.

Register:

```json
"canary:basket": "tsx src/scripts/canaryBasket.ts"
```

The script requires `BASKET_CONTINUATION_SECRET` and exits non-zero on service errors.

- [ ] **Step 5: Replace documentation**

Update `HOW-IT-WORKS.md`:

- one-call initial example;
- `needs_confirmation` response;
- resume example with continuation and answers;
- exact `pack_qty` versus `amount + unit` rules;
- three final recommendation meanings;
- explicit missing-item handling.

Update `README.md` to remove prepare, deprecated qty, `totalsArePartial`, and old cheapest claims. Add the canary command.

- [ ] **Step 6: Run golden and full verification**

Run:

```bash
pnpm --filter @super-mcp/shared build
pnpm --filter @super-mcp/api exec vitest run tests/services/basket/resumableBbqGolden.test.ts
pnpm --filter @super-mcp/api test
pnpm --filter @super-mcp/api typecheck
pnpm --filter @super-mcp/shared test
pnpm --filter @super-mcp/shared typecheck
```

Expected: all PASS.

- [ ] **Step 7: Run the live canary when a populated local DB is available**

Run:

```bash
BASKET_CONTINUATION_SECRET=test-only-basket-continuation-secret-ok \
  pnpm --filter @super-mcp/api canary:basket
```

Expected: one initial result in under 5 seconds, or a confirmation result with at most three questions. After supplying answers through the test harness, final optimization should complete in under 10 seconds and report at least 16/18 best-store coverage when current data supports it.

- [ ] **Step 8: Commit verification and docs**

```bash
git add services/api/tests/services/basket services/api/src/services/basket/optimize.ts services/api/src/scripts/canaryBasket.ts services/api/package.json docs/HOW-IT-WORKS.md README.md
git commit -m "test(basket): lock resumable BBQ optimization flow"
```

---

## Final Verification

- [ ] Run workspace typecheck:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] Run workspace test suite:

```bash
pnpm test
```

Expected: PASS.

- [ ] Search for removed public-contract terms:

```bash
rg "prepare_basket|/v1/basket/prepare|totalsArePartial|deprecated qty|bestNearby|bestInStore" README.md docs/HOW-IT-WORKS.md services/api/src services/api/tests
```

Expected: no live contract references.

- [ ] Verify the final MCP catalog exposes only `optimize_basket` for basket planning and its description documents the initial/resume protocol.

- [ ] Verify no final `needs_confirmation` response contains `bestSingleStore`, `cheapestCompleteStore`, or `multiStore`.

- [ ] Verify every displayed final total includes `pricedLines`, `resolvableLines`, `requestedLines`, and `coverageRatio`.
