# Resumable Basket Optimization Design

**Date:** 2026-07-20  
**Status:** Approved design  
**Compatibility:** Breaking changes are allowed; there are no active users  

## Goal

Make a shopping-list request produce a trustworthy nearby-store recommendation in one tool call when resolution is safe and two calls when human confirmation is required.

The system must preserve the user's original intent across confirmation, calculate purchase quantities from durable pack facts, avoid misleading partial totals, and eliminate manual `search_products` recovery from the normal basket flow.

## Observed Failures

The 18-line Herzliya BBQ basket exposed four distinct failures:

1. `20 יח` of pita became 20 shelf packs when the canonical product was stored as `1000g`, even though ingestion had persisted a ten-piece `piece_count`.
2. The prepare → confirm → optimize flow dropped the original free-text query when only `product_id` was sent back. Commodity equivalence was therefore disabled, reducing the best-store coverage from roughly 16/18 to 7/18.
3. `optimize_basket` built confirmation questions without measuring option availability, so every option displayed `nearbyPricedStores: 0`.
4. Partial subset totals were presented under names such as `cheapest`, making a low-coverage store appear cheaper than a fuller basket.

These are contract and data-flow failures, not isolated search-quality problems.

## Success Criteria

For the Herzliya BBQ regression basket:

- `20 פיתות` resolves to two ten-piece packs when `piece_count = 10`, regardless of whether the canonical size is stored in grams.
- A confirmed generic commodity retains its original query and can use safe, chain-local equivalent SKUs.
- Exact or brand-specific intent remains pinned and is never broadened to unrelated class peers.
- Every confirmation option reports real location-scoped availability.
- The best single-store result covers at least 16 of 18 lines when the underlying catalog has those prices.
- No Coke → Zero, chicken thigh → boneless pargiyot, or arbitrary wine-style substitution occurs without an explicit confirmation.
- A generic basket completes in one `optimize_basket` call; an ambiguous basket completes in two.
- The normal flow makes no per-line `search_products` calls.
- Initial resolution should complete in under 5 seconds and final optimization in under 10 seconds under the current production-sized catalog. These are service targets measured by instrumentation, not hard request timeouts.

## Non-Goals

- Building a general workflow engine.
- Persisting shopping sessions in the database.
- Adding per-product exceptions for pita, onion, wine, or ice.
- Using an LLM during price calculation.
- Guaranteeing that every requested line is stocked locally.
- Retaining the current basket API shape.

## Public Contract

### One primary tool

`optimize_basket` becomes the primary and complete shopping-list tool. `prepare_basket` is removed from the public MCP surface. Internally, resolution and question construction remain separate modules.

The REST surface follows the same contract: `POST /v1/basket/prepare` is removed and `POST /v1/basket/optimize` accepts either an initial or resume request.

The tool is a two-state protocol:

1. Initial request with `items` and location.
2. Resume request with an opaque `continuation` and answers.

### Initial request

```json
{
  "items": [
    {
      "query": "פיתות",
      "amount": 20,
      "unit": "יח"
    }
  ],
  "city": "הרצליה",
  "near": "32.174,34.840",
  "radius_km": 8,
  "include_club": true
}
```

Each item must contain exactly one identifier source:

- `query`
- `product_id`
- `gtin`

Each item must contain exactly one quantity source:

- `pack_qty`
- `amount` and `unit`

The deprecated `qty` alias is removed. Supplying conflicting identifier or quantity sources is a validation error.

### Needs-confirmation response

```json
{
  "status": "needs_confirmation",
  "continuation": "<opaque signed context>",
  "questions": [
    {
      "itemIndex": 3,
      "id": "basket-item-3-product",
      "prompt": "Which product should be used for \"פיתות\"?",
      "required": true,
      "selectionEffect": "representative",
      "options": [
        {
          "productId": "<uuid>",
          "name": "מארז פיתה 10 יחידות",
          "pack": {
            "pieceCount": 10,
            "sizeQty": 1000,
            "sizeUnit": "g"
          },
          "nearbyPricedStores": 7
        }
      ]
    }
  ],
  "preview": {
    "priceScope": "resolved_subset",
    "resolvedLines": 14,
    "requestedLines": 18
  }
}
```

`preview` may describe coverage and candidate stores, but it must not expose fields named `cheapest`, `bestSingleStore`, or `multiStore`. A preview is not an order recommendation.

### Resume request

```json
{
  "continuation": "<opaque signed context>",
  "answers": [
    {
      "item_index": 3,
      "product_id": "<uuid>"
    }
  ]
}
```

The caller does not resend items, quantities, query text, or location. The continuation preserves them.

Every required question must have exactly one answer. Unknown item indexes, duplicate answers, and product IDs not offered for that question are validation errors.

### Final response

```json
{
  "status": "complete",
  "bestSingleStore": {
    "storeId": "<uuid>",
    "total": 386.35,
    "currency": "ILS",
    "pricedLines": 16,
    "resolvableLines": 18,
    "requestedLines": 18,
    "coverageRatio": 0.8889,
    "missingItems": [
      { "itemIndex": 2, "reason": "not_carried_by_chain" },
      { "itemIndex": 17, "reason": "not_carried_by_chain" }
    ]
  },
  "cheapestCompleteStore": null,
  "multiStore": {
    "total": 610.15,
    "pricedLines": 18,
    "requestedLines": 18,
    "coverageRatio": 1
  },
  "items": []
}
```

Definitions:

- `bestSingleStore`: highest practical coverage, then effective cost including distance when distance is reliable.
- `cheapestCompleteStore`: lowest total among stores pricing every resolvable requested line; `null` when none exists.
- `multiStore`: cheapest safe product per line across stores.
- `pricedLines`: lines included in the displayed total.
- `resolvableLines`: lines with a confirmed safe product intent, including lines no nearby store prices.
- `requestedLines`: all original shopping-list lines.
- `coverageRatio`: `pricedLines / requestedLines`.

The legacy top-level `cheapest`, `recommendations.cheapest`, `bestNearby`, and duplicate `bestInStore` fields are removed.

## Continuation

### Requirements

The continuation must:

- preserve original input items, quantity semantics, location, club setting, and offered option IDs;
- be opaque to the caller;
- reject tampering;
- expire after 30 minutes;
- require no database or in-memory session storage;
- carry a protocol version so future formats can fail explicitly.

### Format

Use a versioned, authenticated token:

```ts
interface BasketContinuationV1 {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  input: BasketInitialInput;
  questions: Array<{
    itemIndex: number;
    allowedProductIds: string[];
  }>;
}
```

Serialize deterministic JSON, encode with base64url, and authenticate with HMAC-SHA256 using a basket continuation secret. The token is signed, not encrypted; it contains the same shopping-list text already supplied through MCP. Signature verification and expiry checks happen before answer validation.

Token construction and verification live in a focused module and use Node's top-level `crypto` import. No new dependency is required.

The secret is supplied as `BASKET_CONTINUATION_SECRET`, must contain at least 32 bytes, and is mandatory whenever basket tools/routes are registered. Tests inject a fixed secret. Missing or undersized production configuration fails service startup rather than issuing unsigned continuations.

## Quantity Truth

### Single calculation authority

`resolvePurchaseQty` remains the sole authority for converting user need into shelf quantity. It gains these objective inputs:

```ts
interface PurchaseQuantityInput {
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
```

### Priority

For a count request:

1. Explicit count inferred from a trustworthy product/listing name.
2. Persisted `piece_count`.
3. Canonical product size when its canonical unit is `unit`.
4. Produce piece-weight conversion for known loose produce.
5. One shelf unit per requested unit.

The persisted count is objective pack metadata. It must not be inferred from the user's requested amount.

### Data propagation

`piece_count` must flow through:

- direct product lookup;
- search result and `BasketCandidate`;
- listing pricing;
- confirmation option pack metadata;
- final quantity calculation.

Listing-level `piece_count` takes precedence over product-level `piece_count` during store pricing because it represents the actual shelf listing.

Resolution-time quantity is provisional. Final `BasketLine.qty` is recalculated against the chosen store listing so listing-specific sale facts win.

## Intent and Equivalence

### Separation of concepts

The system must keep three concepts separate:

- **User intent:** query text, explicit brand/variant tokens, requested quantity.
- **Selected representative:** the product chosen or confirmed for display.
- **Priceable set:** safe equivalent SKUs that may satisfy the intent at different chains.

Choosing a representative must not erase the original intent or force every chain to carry that exact UUID.

### Intent modes

Each resolved line is classified into one of:

- `exact`: GTIN, explicit product ID, or explicitly brand/variant-pinned query.
- `commodity`: generic product intent with a reliable class and no explicit differentiator.
- `needs_confirmation`: cross-class ambiguity, unsafe substitution, or insufficient evidence.
- `unresolved`: no plausible product.

Only `commodity` lines may broaden to chain-local class peers. `exact` lines remain pinned.

The continuation preserves the pre-confirmation query. A confirmation chooses a representative but does not change `commodity` into `exact` unless the question explicitly asks the user to select a brand or variant.

Every question carries `selectionEffect`:

- `representative`: preserve the existing commodity intent and use the answer as its preferred display SKU.
- `pin`: the answer selects a distinguishing brand, variant, form, or class and changes the line to exact intent.

The continuation records this effect; the resume request cannot override it.

### Safe peer gates

A peer may join a line's priceable set only when all applicable checks pass:

- compatible deepest known class;
- identical labeled variant;
- all explicit query tokens are satisfied;
- query head is anchored;
- preserved/prepared-form guards pass;
- pack sizes are compatible with request intent;
- candidate is priced in an in-scope store.

Vector-only evidence can recall candidates but cannot authorize auto-resolution or equivalence.

## Availability

Availability is computed once per resolution round for all candidate product IDs and scoped store IDs.

A shared helper returns:

```ts
Map<string, {
  pricedStoreCount: number;
  chainCount: number;
  minPrice: number | null;
}>
```

This map is used by:

- candidate ranking;
- confirmation option ordering;
- question serialization;
- commodity equivalence assembly.

Options are ordered by:

1. intent safety;
2. positive local availability;
3. greater chain diversity;
4. lower local minimum price;
5. deterministic resolution score.

An unavailable option may be shown only when fewer than three safe locally priced options exist.

## Recommendation Semantics

### No final recommendations from incomplete resolution

When required questions remain, the response status is `needs_confirmation` and price output is a `preview`. Final recommendation fields are absent.

When all lines are resolved, unavailable lines remain explicit item outcomes and final recommendations may be computed over the priceable lines.

### Store ranking

`bestSingleStore`:

1. maximize `pricedLines`;
2. among stores within one line of maximum coverage, minimize:
   `total + distanceKm * distancePenaltyPerKm`;
3. prefer known distance over unknown distance;
4. tie-break deterministically by store ID.

`cheapestCompleteStore`:

- eligible only when `pricedLines === resolvableLines`;
- minimize total;
- tie-break by distance, then store ID.

`multiStore`:

- choose the cheapest safe listing for each resolvable line;
- preserve missing lines explicitly;
- report store count and per-store subtotals.

Every displayed total is paired with `pricedLines`, `requestedLines`, and `coverageRatio`.

## Processing Flow

### Initial call

1. Validate item and location shapes.
2. Resolve location once.
3. Search query lines concurrently with bounded concurrency.
4. Load product classes, pack facts, and candidate availability in batches.
5. Build intent modes and safe priceable sets.
6. If confirmations remain:
   - generate real-availability questions;
   - create continuation;
   - optionally compute a clearly labeled preview;
   - return `needs_confirmation`.
7. Otherwise price stores and return `complete`.

### Resume call

1. Verify continuation signature, version, and expiry.
2. Validate answers against offered choices.
3. Apply selections while retaining original intent modes and quantities.
4. Recompute local availability to avoid trusting stale token counts.
5. Enrich commodity priceable sets.
6. Price stores and return `complete`, or return a new continuation only if an answer exposes a genuinely new required ambiguity.

## Error Handling

Use explicit bad-request codes/messages for:

- invalid item identifier combination;
- invalid quantity combination;
- invalid or expired continuation;
- duplicate answer;
- missing required answer;
- answer not offered for the question;
- location missing from an initial request;
- initial-only fields supplied with a continuation.

Catalog sparsity is not an exception. It produces `unresolved` or `unavailable` item outcomes.

## Performance and Observability

Emit one structured `basket_optimize` event per call with:

- protocol state: `initial` or `resume`;
- requested, resolved, confirmed, unresolved, and priced line counts;
- question count;
- candidate store count;
- search, classification, availability, equivalence, pricing, and total milliseconds;
- DB query count when available;
- best single-store coverage;
- continuation token byte length;
- failure code when applicable.

No raw query text, product names, or token content is logged.

Availability and class loading must remain batched. Per-line product searches may run with bounded concurrency; per-line availability SQL is prohibited.

## Testing Strategy

### Unit tests

- `resolvePurchaseQty`: `20 יח`, `1000g`, `pieceCount=10`, no count in name → two packs.
- Name-inferred count overrides conflicting persisted count.
- Listing count overrides product count at final pricing.
- Exact lines cannot broaden.
- Commodity confirmed lines retain safe peers.
- Continuation signature, expiry, version, and answer validation.
- Recommendation ranking and deterministic tie-breaks.

### Service integration tests

- Initial optimize with no ambiguity returns `complete`.
- Initial optimize with ambiguity returns `needs_confirmation` and no final recommendation fields.
- Resume requires no repeated query, amount, unit, or location.
- Resume retains commodity intent and reaches the same coverage as one-shot free-text optimization.
- Question options carry non-zero availability when local prices exist.
- A partial preview never contains final recommendation field names.

### Golden regression

Use the exact 18-line Herzliya BBQ request with `amount + unit`, not legacy hardcoded quantities.

The golden must exercise real resolution modules rather than mocking `resolveItems`. Database/search boundaries may use deterministic fixtures.

Assertions:

- one or two calls only;
- no manual search tool;
- pita quantity equals two packs;
- at least 16/18 best-store coverage when fixture availability supports it;
- at most three required questions;
- exact/variant safety invariants;
- all totals include coverage metadata;
- response payload remains bounded.

### Live canary

Add an opt-in script that runs the real Herzliya basket against a populated local database and prints only timing, coverage, questions, and quantity decisions. It is not part of deterministic CI.

## Documentation Changes

- Document only the resumable `optimize_basket` flow in MCP instructions and `HOW-IT-WORKS.md`.
- Remove examples that reconstruct confirmed lines with product IDs.
- Remove stale statements that partial totals are final recommendations.
- Explain `pack_qty` versus `amount + unit` with count, weight, and packaged examples.
- Document the exact meanings of the three final plan fields.

## Rollout Order

1. Quantity truth and `piece_count` propagation.
2. Continuation codec and new tool schema.
3. Unified availability and questions.
4. Intent-preserving resume and safe equivalence.
5. Recommendation response and ranking replacement.
6. End-to-end golden, observability, documentation, and removal of the old public prepare flow.

Each stage must keep its focused tests green. The new public contract is exposed only after the full golden passes.
