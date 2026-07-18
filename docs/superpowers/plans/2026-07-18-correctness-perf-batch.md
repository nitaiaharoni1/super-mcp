# Correctness & Performance Batch (Non-Colliding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed bugs and hot-path performance gaps from the 2026-07-17 re-review that do NOT touch files the concurrent basket-flow agent has dirty.

**Architecture:** Surgical fixes across promotions/history/substitutes queries, the ingestion reaper/FTP pool/unit-price path, one index+trigger migration, and DB pool hardening. No behavior redesign; every fix has a regression test.

**Tech Stack:** TypeScript monorepo (pnpm), Postgres + pgvector, vitest.

**CRITICAL CONSTRAINT — concurrent agent:** Another agent has uncommitted work in `services/api/src/services/basket/` (resolve.ts, resolveQuery.ts, resolutionDecision.ts, optimize.ts, types.ts, index.ts, prepare.ts, rankQueryCandidates.ts) and `services/api/src/services/search/` (lexicalSql.ts, scoredSearch.ts, vectorSearch.ts, exactProductSearch.ts, locationScope.ts) plus `packages/shared/src/intent/` and `packages/db/src/migrations/010_shopping_defaults.sql`. **Never edit those files. Never `git add -A` — stage exact paths only.** `loadPricingData.ts` and `priceStoreBasket.ts` are currently clean; re-check `git status` before Task 6 and skip it if they've gone dirty.

**Migration numbering:** 010 (shopping defaults, uncommitted, other agent) and 011 (match_miss, committed) are taken. This plan uses **012**. Re-check `ls packages/db/src/migrations/` before Task 7.

---

### Task 1: Promotions product filter — fix `'\D'` escape + include chain-wide promos

The SQL lives in a JS template literal, so `'\D'` reaches Postgres as `'D'` (strips the letter D, not non-digits). Also `pr.store_id = $1` excludes chain-wide promos (`store_id IS NULL`) that the pricing path deliberately applies.

**Files:**
- Modify: `services/api/src/services/promotions/listPromotions.ts` (the `WHERE` clause, ~lines 76-84)
- Test: `services/api/tests/services/promotions/listPromotions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Mirror the db-mock pattern used by `services/api/tests/services/basket/profileBatch.test.ts` (mock `@super-mcp/db`, capture SQL text). If `listPromotions.ts` imports more symbols from `@super-mcp/db` than `query`, add them to the mock as `vi.fn()`.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

describe("listPromotions SQL", () => {
  beforeEach(() => query.mockClear());

  it("sends a real \\D regex to Postgres (JS must not eat the backslash)", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ productId: "11111111-1111-1111-1111-111111111111" });
    const sql = query.mock.calls[0]![0] as string;
    // The string Postgres receives must contain backslash-D, not bare D.
    expect(sql).toContain(String.raw`'\D'`);
  });

  it("store filter includes chain-wide promotions (store_id IS NULL)", async () => {
    const { listPromotions } = await import(
      "../../../src/services/promotions/listPromotions.js"
    );
    await listPromotions({ storeId: "22222222-2222-2222-2222-222222222222" });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/store_id IS NULL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/promotions/listPromotions.test.ts`
Expected: FAIL — first test finds `'D'` not `'\D'`; second finds no `store_id IS NULL`.

- [ ] **Step 3: Fix the SQL**

In `listPromotions.ts`, change the two WHERE arms:

```ts
     WHERE ($1::uuid IS NULL
        OR pr.store_id = $1
        OR (pr.store_id IS NULL
            AND pr.chain_id = (SELECT chain_id FROM store WHERE id = $1)))
```

and in the `$2` EXISTS subquery, double the backslash so Postgres receives `\D`:

```ts
             AND (l2.item_code = pi2.item_code OR l2.item_code = regexp_replace(pi2.item_code, '\\D', '', 'g'))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/promotions/listPromotions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/promotions/listPromotions.ts services/api/tests/services/promotions/listPromotions.test.ts
git commit -m "fix(promotions): send real \D regex to Postgres, include chain-wide promos in store filter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Price history — return the newest window, not the oldest

`ORDER BY pp.source_ts ASC LIMIT 5000` silently drops the newest data once a product exceeds 5000 points.

**Files:**
- Modify: `services/api/src/services/products/history.ts` (~lines 25-40)
- Test: `services/api/tests/services/products/history.test.ts` (create; if a history test file already exists, extend it)

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

describe("getPriceHistory window", () => {
  beforeEach(() => query.mockReset());

  it("selects the NEWEST 5000 rows but returns them oldest-first", async () => {
    const rows = [
      { store_id: "s1", store_name: "A", chain_id: "c1", price: "2", unit_price: null, currency: "ILS", source_ts: new Date("2026-07-02") },
      { store_id: "s1", store_name: "A", chain_id: "c1", price: "1", unit_price: null, currency: "ILS", source_ts: new Date("2026-07-01") },
    ];
    query.mockResolvedValue({ rows }); // DESC order, as Postgres will return it
    const { getPriceHistory } = await import(
      "../../../src/services/products/history.js"
    );
    const out = await getPriceHistory("p1", {});
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/ORDER BY pp\.source_ts DESC/);
    // API output stays chronological (oldest first).
    expect(out.map((r) => r.sourceTs)).toEqual([new Date("2026-07-01"), new Date("2026-07-02")]);
  });
});
```

Adjust the exported function name/return-field names to match the actual module (read `history.ts` first; the function maps `source_ts` into a camelCase field).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/products/history.test.ts`
Expected: FAIL — SQL contains `ASC`.

- [ ] **Step 3: Implement**

In `history.ts`:

```ts
     ORDER BY pp.source_ts DESC
     LIMIT 5000`,
```

and reverse before mapping so the response shape is unchanged (chronological):

```ts
  // LIMIT keeps the newest window; reverse back to chronological for the API.
  return [...res.rows].reverse().map((r) => ({
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/products/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/products/history.ts services/api/tests/services/products/history.test.ts
git commit -m "fix(products): price history keeps the newest 5000 points instead of the oldest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Substitutes — rank the candidate pool before LIMIT (not by UUID)

`SELECT DISTINCT ON (p.id) ... ORDER BY p.id, sp.unit_price ASC LIMIT n*8` keeps the n*8 lowest-UUID products — an arbitrary subset for broad categories.

**Files:**
- Modify: `services/api/src/services/substitutes/suggestSubstitutes.ts` (~lines 137-168)
- Test: `services/api/tests/services/substitutes/suggestSubstitutes.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));
```

(Plus whatever the module additionally imports — check its imports and mock them.) Test body: call `suggestSubstitutes` with a minimal product fixture (mock the product-lookup query's first call to return one product row, second call `rows: []`), then assert the candidate SQL orders the outer selection by relevance:

```ts
    const candidateSql = query.mock.calls.at(-1)![0] as string;
    expect(candidateSql).toMatch(/ORDER BY\s+c\.same_category DESC,\s*c\.name_sim DESC,\s*c\.unit_price ASC/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/substitutes/suggestSubstitutes.test.ts`
Expected: FAIL — no outer ORDER BY.

- [ ] **Step 3: Implement**

Wrap the existing SELECT so `DISTINCT ON (p.id)` still picks the cheapest offer per product, but the LIMIT keeps the most *relevant* products:

```sql
    SELECT * FROM (
      SELECT DISTINCT ON (p.id)
        -- existing select list unchanged
      FROM ...
      WHERE ...
      ORDER BY p.id, sp.unit_price ASC
    ) c
    ORDER BY c.same_category DESC, c.name_sim DESC, c.unit_price ASC
    LIMIT $<limitIdx>
```

Keep the JS-side sort/slice as-is (it now operates on a relevant pool).

- [ ] **Step 4: Run test + existing substitutes tests**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/substitutes/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/substitutes/suggestSubstitutes.ts services/api/tests/services/substitutes/suggestSubstitutes.test.ts
git commit -m "fix(substitutes): select candidate pool by relevance instead of UUID order

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Reaper guard — never delete on a short digit key

`reapReclassifiedListing(chain, "AB-42", "42")` deletes an unrelated listing whose `item_code='42'` and cascade-wipes its price history. A real GTIN-classification flip always involves a key with ≥8 digits.

**Files:**
- Modify: `packages/db/src/queries/listings.ts` (`reapReclassifiedListing`, ~line 69)
- Test: `packages/db/tests/queries/listings.reap.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { reapReclassifiedListing } from "../../src/queries/listings.js";
import type { PoolClient } from "pg";

function fakeClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
}

describe("reapReclassifiedListing guard", () => {
  it("skips when the other key has fewer than 8 digits (not a GTIN flip)", async () => {
    const client = fakeClient();
    await reapReclassifiedListing("chain1", "AB-42", "42", client);
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });

  it("still reaps a genuine classification flip (8+ digit keys)", async () => {
    const client = fakeClient();
    await reapReclassifiedListing("chain1", "7290001234567", "07290001234567", client);
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/db exec vitest run tests/queries/listings.reap.test.ts`
Expected: FAIL — first test sees 2 query calls.

- [ ] **Step 3: Implement**

At the top of `reapReclassifiedListing`, after the equality early-return:

```ts
  if (currentItemCode === otherItemCode) return;
  // A GTIN classification flip always involves an 8+ digit key on the other
  // side (isGtinItem requires it). A short digit key here means the item was
  // never GTIN-classified — deleting would hit an unrelated internal-code
  // listing and cascade-wipe its price history.
  if (otherItemCode.replace(/\D/g, "").length < 8) return;
```

- [ ] **Step 4: Run db tests**

Run: `pnpm --filter @super-mcp/db exec vitest run`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/listings.ts packages/db/tests/queries/listings.reap.test.ts
git commit -m "fix(db): reap guard prevents deleting unrelated listings on short digit keys

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: FtpPool — reject stranded waiters instead of dropping them

`pumpWaiters()` discards a waiter when reconnect fails (never resolved → pipeline hangs until the 6h stale-run reaper). Waiters also queue with no timeout.

**Files:**
- Modify: `services/ingestion/src/sources/common/ftpPool.ts`
- Test: `services/ingestion/tests/ftpPool.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`FtpPool` takes a `connect` callback, so no real FTP is needed — `basic-ftp`'s `Client` is only constructed inside `acquire`, and `connect` can throw before any network use:

```ts
import { describe, expect, it } from "vitest";
import { FtpPool } from "../src/sources/common/ftpPool.js";

describe("FtpPool waiter handling", () => {
  it("rejects a queued waiter when reconnection fails, instead of hanging", async () => {
    let connects = 0;
    const pool = new FtpPool(1, async () => {
      connects++;
      if (connects > 1) throw new Error("reconnect refused");
    });

    // Occupy the single slot, then queue a waiter, then break the held client.
    const releaseHeld = pool.withClient(async () => {
      const waiter = pool.withClient(async () => "never");
      // Give the waiter a tick to enqueue.
      await new Promise((r) => setTimeout(r, 10));
      // Breaking out of withClient with an error closes the client and pumps waiters.
      await expect(waiter).rejects.toThrow(/reconnect refused|acquire/i);
      throw new Error("break connection");
    });
    await expect(releaseHeld).rejects.toThrow("break connection");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/ingestion exec vitest run tests/ftpPool.test.ts`
Expected: FAIL — the waiter promise never settles (test times out) under current code.

- [ ] **Step 3: Implement**

In `ftpPool.ts`, change waiters to carry both callbacks and add an acquire timeout:

```ts
interface Waiter {
  resolve: (client: Client) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}
```

```ts
  private waiters: Waiter[] = [];
```

In `acquire()`, replace the bare promise:

```ts
    return new Promise<Client>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error("ftp pool acquire timeout"));
      }, this.timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
```

In `release()` and anywhere a waiter is dequeued and given a client:

```ts
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(client);
      return;
    }
```

In `pumpWaiters()`, reject on failure instead of dropping:

```ts
    const waiter = this.waiters.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    void this.acquire().then(
      (client) => waiter.resolve(client),
      (err) => {
        console.warn(JSON.stringify({ event: "ftp_pool_acquire_failed", error: err instanceof Error ? err.message : String(err) }));
        waiter.reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
```

In `close()`, reject all remaining waiters:

```ts
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error("FtpPool is closed"));
    }
```

- [ ] **Step 4: Run ingestion tests**

Run: `pnpm --filter @super-mcp/ingestion exec vitest run`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/sources/common/ftpPool.ts services/ingestion/tests/ftpPool.test.ts
git commit -m "fix(ingestion): FTP pool rejects stranded waiters and times out acquire instead of hanging runs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Basket pricing — check ALL of a chain's listings for a product

`loadPricingData` keeps one arbitrary listing per (chain, product); if the unpriced one wins, the store falsely reports `no_price_data`.

**PRE-CHECK:** run `git status --short services/api/src/services/basket/`. If `loadPricingData.ts` or `priceStoreBasket.ts` shows as modified by the other agent, SKIP this task and note it as deferred.

**Files:**
- Modify: `services/api/src/services/basket/loadPricingData.ts` (map building, ~lines 22-27; type at ~line 6)
- Modify: `services/api/src/services/basket/priceStoreBasket.ts` (lookup loop, ~lines 66-84)
- Test: `services/api/tests/services/basket/priceStoreBasket.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Extend the existing `priceStoreBasket.test.ts` (read it first; reuse its fixture builders). New case: one chain, one product, two listings L1/L2; only L2 has a price row at the store; the map contains **both** listings; assert the line is priced from L2, not reported `no_price_data`. The Map value type changes to `ListingRow[]`, so build `new Map([[chainId, new Map([[productId, [l1, l2]]])]])`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @super-mcp/api exec vitest run tests/services/basket/priceStoreBasket.test.ts`
Expected: FAIL (type error or missing-item result).

- [ ] **Step 3: Implement**

`loadPricingData.ts` — accumulate instead of overwrite:

```ts
export interface BasketPricingContext {
  listingByChainAndProduct: Map<string, Map<string, ListingRow[]>>;
  ...
}
```

```ts
  for (const listing of listingRes.rows) {
    const byProduct = listingByChainAndProduct.get(listing.chain_id) ?? new Map<string, ListingRow[]>();
    const rows = byProduct.get(listing.product_id) ?? [];
    rows.push(listing);
    byProduct.set(listing.product_id, rows);
    listingByChainAndProduct.set(listing.chain_id, byProduct);
  }
```

`priceStoreBasket.ts` — update the signature's Map type, then in the candidate loop replace the single-listing lookup:

```ts
      const listings = byProduct?.get(candidate.productId) ?? [];
      if (listings.length === 0) continue;
      sawListing = true;
      let picked: { listing: ListingRow; priceRow: StorePriceRow } | null = null;
      for (const l of listings) {
        const pr = priceByListingAndStore.get(`${l.id}:${store.id}`);
        if (pr) { picked = { listing: l, priceRow: pr }; break; }
      }
      if (!picked) continue;
```

then use `picked.listing` / `picked.priceRow` where `listing` / `priceRow` were used. Run `grep -rn 'listingByChainAndProduct' services/api/src` and fix any other consumer's types (optimize.ts only passes it through — do not otherwise touch optimize.ts).

- [ ] **Step 4: Run api tests + typecheck**

Run: `pnpm --filter @super-mcp/api exec vitest run && pnpm --filter @super-mcp/api exec tsc -p tsconfig.json --noEmit`
Note: `tsc` will still fail on the other agent's pre-existing `resolve.ts:256` TS2783 errors — that failure is pre-existing and not yours; confirm no NEW errors appear in the files you touched.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/services/basket/loadPricingData.ts services/api/src/services/basket/priceStoreBasket.ts services/api/tests/services/basket/priceStoreBasket.test.ts
git commit -m "fix(basket): price against all of a chain's listings for a product, not an arbitrary one

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Migration 012 — hot-path indexes, change-only dirty triggers, data fixes

**Files:**
- Create: `packages/db/src/migrations/012_perf_indexes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 012_perf_indexes.sql
-- Hot-path indexes found missing in the 2026-07-17 review, change-only
-- semantic dirty triggers, and small data fixes.

-- activePromotions joins listing.item_code -> promotion_item on every
-- compare_prices / basket optimize; only (promotion_id, item_code) PK and
-- item_code_norm existed.
CREATE INDEX IF NOT EXISTS promotion_item_code_idx ON promotion_item (item_code);

-- suggestSubstitutes filters on category_l1/category_l2; unindexed arms of an
-- OR force full scans of product.
CREATE INDEX IF NOT EXISTS product_category_l1_idx ON product (category_l1) WHERE category_l1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_category_l2_idx ON product (category_l2) WHERE category_l2 IS NOT NULL;

-- Active-now predicate is start_ts <= now() AND end_ts >= now(); the old
-- (start_ts, end_ts) index has a uselessly unselective leading column.
CREATE INDEX IF NOT EXISTS promotion_chain_end_ts_idx ON promotion (chain_id, end_ts);

-- Exact duplicate of 006's product_embedding_model_idx.
DROP INDEX IF EXISTS product_embedding_model_only_idx;

-- UPDATE OF name fires on ASSIGNMENT, not change; every upsert of every
-- ingest run re-dirtied the whole catalog. WHEN clauses make the queue
-- reflect real changes only. INSERTs must still always enqueue, so the
-- insert trigger is split out (WHEN with OLD is illegal on INSERT).
DROP TRIGGER IF EXISTS product_semantic_dirty_trg ON product;
CREATE TRIGGER product_semantic_dirty_ins_trg
  AFTER INSERT ON product
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_semantic_index_dirty();
CREATE TRIGGER product_semantic_dirty_upd_trg
  AFTER UPDATE OF name, brand ON product
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.brand IS DISTINCT FROM NEW.brand)
  EXECUTE FUNCTION enqueue_semantic_index_dirty();

DROP TRIGGER IF EXISTS listing_semantic_dirty_trg ON listing;
CREATE TRIGGER listing_semantic_dirty_ins_trg
  AFTER INSERT ON listing
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_semantic_index_dirty();
CREATE TRIGGER listing_semantic_dirty_upd_trg
  AFTER UPDATE OF name, product_id ON listing
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.product_id IS DISTINCT FROM NEW.product_id)
  EXECUTE FUNCTION enqueue_semantic_index_dirty();

-- 010_shopping_defaults seeded 'פепсי' with Cyrillic епс; it can never match
-- Hebrew catalog text. (No-op on DBs where 010 has not run.)
UPDATE semantic_term SET term = 'פפסי'
WHERE ontology_version = 'he-retail-v1' AND term = 'פепсי'
  AND NOT EXISTS (
    SELECT 1 FROM semantic_term t2
    WHERE t2.ontology_version = 'he-retail-v1' AND t2.term = 'פפסי'
      AND t2.concept_id = semantic_term.concept_id
  );
```

Before writing, `grep -n 'term' packages/db/src/migrations/010_shopping_defaults.sql` to confirm the `semantic_term` column names/unique constraint the UPDATE must respect (adjust the NOT EXISTS to the actual unique key; if 010 was renumbered or the term fixed meanwhile, drop the UPDATE block).

- [ ] **Step 2: Apply and verify idempotency**

Run: `pnpm db:migrate && pnpm db:migrate`
Expected: first run applies 012; second run is a no-op ("already applied"). Then verify triggers:

```bash
psql "$DATABASE_URL" -c "\d listing" | grep -A2 semantic_dirty
```

Expected: `listing_semantic_dirty_ins_trg` and `listing_semantic_dirty_upd_trg` with WHEN clause.

- [ ] **Step 3: Verify the dirty queue stays quiet on a no-change upsert**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM semantic_index_dirty;" \
&& psql "$DATABASE_URL" -c "UPDATE listing SET name = name WHERE id = (SELECT id FROM listing LIMIT 1);" \
&& psql "$DATABASE_URL" -c "SELECT count(*) FROM semantic_index_dirty;"
```

Expected: identical counts before/after.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/012_perf_indexes.sql
git commit -m "perf(db): hot-path indexes, change-only semantic dirty triggers, drop dup index

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Ingestion — stop writing mixed-scale unit prices; widen transient detection

The fallback `record.unitPrice` is the feed's raw per-1kg/per-1L value written into a per-100g/100ml column (₪51.6 "lemons" in production output). And the transient regex misses common fetch/pg failure strings, so a mid-file outage burns rows as errors and can still classify "success".

**Files:**
- Modify: `services/ingestion/src/normalize.ts` (~line 217)
- Modify: `services/ingestion/src/transient.ts`
- Test: `services/ingestion/tests/transient.test.ts` (create), `services/ingestion/tests/normalize.counters.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

`transient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTransientIngestionError } from "../src/transient.js";

describe("isTransientIngestionError", () => {
  it.each([
    "fetch failed",
    "The operation was aborted",
    "TimeoutError: signal timed out",
    "connect ECONNREFUSED 10.0.0.1:5432",
    "connect EHOSTUNREACH",
    "sorry, too many clients already",
    "terminating connection due to administrator command",
    "timeout exceeded when trying to connect",
    "ftp pool acquire timeout",
  ])("treats %s as transient", (msg) => {
    expect(isTransientIngestionError(msg)).toBe(true);
  });

  it("still rejects genuine data errors", () => {
    expect(isTransientIngestionError("invalid input syntax for type uuid")).toBe(false);
  });
});
```

In `normalize.counters.test.ts`, extend the unparseable-unit case to assert `upsertStorePrice` was called with `unitPrice: null` (not the feed's raw value) — the mock already captures calls.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @super-mcp/ingestion exec vitest run tests/transient.test.ts tests/normalize.counters.test.ts`
Expected: FAIL on the new strings and on the unitPrice assertion.

- [ ] **Step 3: Implement**

`transient.ts`:

```ts
export function isTransientIngestionError(message: string): boolean {
  return /client is closed|connection terminated|server sent fin|econnreset|epipe|etimedout|server closed the connection|fetch failed|operation was aborted|timeouterror|econnrefused|ehostunreach|too many clients|terminating connection|timeout exceeded when trying to connect|ftp pool acquire timeout/i.test(
    message,
  );
}
```

`normalize.ts` (~line 217) — drop the raw feed fallback; the two values are in different scales and cannot share a column:

```ts
          // Only our canonical per-100g/100ml/unit math goes in unit_price.
          // The feed's UnitOfMeasurePrice is per-1kg/1L for some chains and
          // per-100g for others — mixing scales corrupted unit-price sorts
          // (₪51.6 "lemons"). Unparseable-unit rows keep price only; the miss
          // is already counted via unit_unparseable telemetry.
          unitPrice: unit.pricePerCanonical ?? null,
```

- [ ] **Step 4: Run ingestion tests**

Run: `pnpm --filter @super-mcp/ingestion exec vitest run`
Expected: PASS. If an existing normalize test asserts the old fallback behavior, update that assertion to `null` — the old behavior is the bug.

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/normalize.ts services/ingestion/src/transient.ts services/ingestion/tests/transient.test.ts services/ingestion/tests/normalize.counters.test.ts
git commit -m "fix(ingestion): never mix feed unit-price scales into unit_price; widen transient-error detection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: DB pool hardening — timeouts and safe rollback

**Files:**
- Modify: `packages/db/src/client/index.ts` (`getPool`, `withTransaction`)
- Modify: `packages/db/src/schema/migrate.ts` (rollback guard, ~lines 57-59)

- [ ] **Step 1: Implement (config change; covered by the whole suite, no new unit test)**

`getPool()`:

```ts
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // Bound runaway scans; ingestion overrides per-session if a batch
      // legitimately needs longer.
      options: "-c statement_timeout=30000",
    });
```

`withTransaction` — don't let a dead-connection ROLLBACK mask the real error:

```ts
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection already dead; the original error is the one that matters.
      }
      throw err;
    }
```

Apply the same try/catch around the ROLLBACK in `schema/migrate.ts`.

- [ ] **Step 2: Run the full db + ingestion suites (they exercise the pool paths)**

Run: `pnpm --filter @super-mcp/db exec vitest run && pnpm --filter @super-mcp/ingestion exec vitest run`
Expected: PASS.

- [ ] **Step 3: Sanity-run a real ingest against the local DB** (statement_timeout must not break normal batches)

Run: `pnpm --filter @super-mcp/ingestion run ingest:fixture` (or the repo's fixture ingest script — check `package.json`)
Expected: completes with status success; no `statement timeout` errors in output.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/client/index.ts packages/db/src/schema/migrate.ts
git commit -m "fix(db): pool timeouts + statement_timeout; rollback failures no longer mask original errors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deferred (tracked, not in this batch)

- **Snapshot reconciliation** (delisted prices/promos live forever; 2099 phantom promos) — needs a mark-and-sweep design tied to run bookkeeping; schedule as its own plan.
- **Row batching in ingestion** (5-7 round trips/row) — highest perf win, but it rewrites `applyOne`'s write path; own plan, after snapshot reconciliation decides the staging-table shape.
- **Per-model HNSW partial indexes** — needs the embedding-model registry decision first.
- **`resolve.ts:256` TS2783 build break** — one-line fix but inside the concurrent agent's dirty file; they should fold it into their commit.

## Final verification (after all tasks)

```bash
pnpm --filter @super-mcp/shared exec vitest run \
&& pnpm --filter @super-mcp/db exec vitest run \
&& pnpm --filter @super-mcp/ingestion exec vitest run \
&& pnpm --filter @super-mcp/api exec vitest run \
&& git status --short   # verify ONLY plan files staged/committed; other agent's files untouched
```
