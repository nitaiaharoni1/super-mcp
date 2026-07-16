# Ingest Correctness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix seven correctness/robustness issues found in the 2026-07-17 code review: GTIN leading-zero identity misses, promo item-code mismatches, region-filter false positives, a dead regex in Shufersal discovery, stale-feed price overwrites, silently-green metadata-only ingest runs, and per-row chain upsert write amplification. Plus fix a misleading comment and README gap.

**Architecture:** All fixes are small, local changes to existing modules — no new subsystems. Shared identity helpers change first (`packages/shared`), then the ingestion normalizer/adapters that consume them, then the DB write guard, then docs. Pure logic gets vitest unit tests (the repo has no DB test harness; `packages/db` changes are verified by typecheck plus a documented manual SQL check).

**Tech Stack:** TypeScript ESM monorepo (pnpm workspaces), vitest, Postgres via `pg`. Root `pnpm test` builds all packages then runs every suite — use it whenever a change crosses package boundaries.

**Worktree policy:** Per user CLAUDE.md, do NOT use git worktrees. Work in the main working directory on the current branch.

---

## Context for the implementer (read this first)

The data flow: adapters (`services/ingestion/src/adapters/`) discover/fetch/parse Israeli supermarket price feeds into `RawRecord`s; `services/ingestion/src/normalize.ts` writes them to Postgres via repos in `packages/db/src/repos.ts`. Product identity is GTIN-first: `packages/shared/src/units.ts` has `isGtinItem` / `normalizeGtin`, and a listing row is keyed on `(chain_id, item_code)` where `item_code` is the normalized GTIN for barcode items and the raw chain code otherwise.

The issues, in the order this plan fixes them:

1. **GTIN leading zeros** — `normalizeGtin` only strips non-digits, so `07290000173199` and `7290000173199` become two different products, defeating cross-chain merging when chains zero-pad differently.
2. **Promo item codes matched raw** — promo `itemCodes` are stored as-is, but GTIN listings are keyed on the *normalized* GTIN, so padded promo codes silently produce `promotion_item.listing_id = NULL` and never affect basket math.
3. **Region name-hint false positive** — the covered town "אזור" (Azor) is also the Hebrew word for "zone". Any store anywhere named "…אזור תעשייה…" (industrial zone) passes the name hint in `regions.ts`; the city prefix-match has the same hole for city fields like "אזור תעשייה ספיר".
4. **Dead regex in Shufersal discovery** — `shufersal.ts` line 58 uses `[^"'\\s]` inside a regex literal, which excludes the *letter s* instead of whitespace, so the absolute-URL discovery pattern can never match a real URL (they all contain "s").
5. **Stale-feed overwrite** — `upsertStorePrice` has no `source_ts` guard; replaying an archived (older) file overwrites the latest price and appends a bogus history point.
6. **Metadata-only runs report success** — if the Stores file fails to parse, the region filter selects zero price/promo files, the run ingests only store metadata, yet `classifyStatus` returns `success` because store rows count as `rowsOk`.
7. **Chain upsert per row** — `Normalizer.applyOne` calls `upsertChain` for every single record (100k+ per file). Stores are cached; chains are not.

Note on data migration: this project is pre-production (single initial commit, local dev DBs). Task 1 changes identity keys for zero-padded GTINs. Existing listings self-heal on re-ingest via `reapReclassifiedListing` (it is called with the raw item code as the "other" key, which is exactly the old padded listing key). Orphaned zero-padded `product` rows are harmless; an optional cleanup SQL is included in Task 1.

---

### Task 1: Strip leading zeros in `normalizeGtin`

**Files:**
- Modify: `packages/shared/src/units.ts:152-154`
- Test: `packages/shared/src/units.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/units.test.ts` (add `normalizeGtin` to the existing import from `./units.js`):

```ts
describe("normalizeGtin", () => {
  it("strips non-digits", () => {
    expect(normalizeGtin(" 7290-000173199 ")).toBe("7290000173199");
  });

  it("strips leading zeros so padded GTINs merge (GTIN-14 padding, EAN-13 = 0 + UPC-A)", () => {
    expect(normalizeGtin("07290000173199")).toBe("7290000173199");
    expect(normalizeGtin("0007290000173199")).toBe("7290000173199");
  });

  it("keeps degenerate short codes unchanged", () => {
    expect(normalizeGtin("0000123")).toBe("0000123");
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @super-mcp/shared test`
Expected: FAIL — `normalizeGtin("07290000173199")` returns `"07290000173199"` (leading zero kept).

- [ ] **Step 3: Implement**

In `packages/shared/src/units.ts`, replace:

```ts
export function normalizeGtin(itemCode: string): string {
  return itemCode.replace(/\D/g, "");
}
```

with:

```ts
export function normalizeGtin(itemCode: string): string {
  const digits = itemCode.replace(/\D/g, "");
  // GS1 comparison ignores leading zeros (GTIN-14 is zero-padded; EAN-13 = 0 + UPC-A).
  // Keep degenerate short codes as-is so we never return an empty/ambiguous key.
  const stripped = digits.replace(/^0+/, "");
  return stripped.length >= 8 ? stripped : digits;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @super-mcp/shared test`
Expected: PASS (all, including existing `computeUnitPrice`/`isGtinItem` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/units.ts packages/shared/src/units.test.ts
git commit -m "fix(shared): normalize GTIN leading zeros so padded barcodes merge cross-chain

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Optional one-off cleanup for an existing local DB** (not part of the commit; run only if you keep your current DB instead of re-seeding). After the next full re-ingest, orphaned zero-padded products can be removed with:

```sql
DELETE FROM product
WHERE gtin ~ '^0' AND NOT EXISTS (SELECT 1 FROM listing WHERE listing.product_id = product.id);
```

---

### Task 2: Add shared `canonicalItemCode` helper

This is the single definition of "the item_code a listing row is keyed on", so the price path and the promo path (Task 3) can never drift apart.

**Files:**
- Modify: `packages/shared/src/units.ts` (append at end)
- Test: `packages/shared/src/units.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/units.test.ts` (add `canonicalItemCode` to the import from `./units.js`):

```ts
describe("canonicalItemCode", () => {
  it("returns the normalized GTIN for barcode-capable codes", () => {
    expect(canonicalItemCode(1, "07290000173199")).toBe("7290000173199");
  });

  it("returns internal codes unchanged", () => {
    expect(canonicalItemCode(0, "INTERNAL-42")).toBe("INTERNAL-42");
    expect(canonicalItemCode(1, "123")).toBe("123");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @super-mcp/shared test`
Expected: FAIL with "canonicalItemCode is not a function" (or missing export).

- [ ] **Step 3: Implement**

Append to `packages/shared/src/units.ts`:

```ts
/** The item_code a listing row is keyed on: normalized GTIN for barcode items, raw code otherwise. */
export function canonicalItemCode(itemType: number, itemCode: string): string {
  return isGtinItem(itemType, itemCode) ? normalizeGtin(itemCode) : itemCode;
}
```

Check `packages/shared/src/index.ts`: it should already re-export everything from `./units.js` (it exports `computeUnitPrice` etc. that way). If it uses named exports instead of `export *`, add `canonicalItemCode` to the list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @super-mcp/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/units.ts packages/shared/src/units.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add canonicalItemCode helper for listing identity

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Normalize promo item codes + cache chain upserts in the Normalizer

**Files:**
- Modify: `services/ingestion/src/normalize.ts`
- Test (create): `services/ingestion/src/normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `services/ingestion/src/normalize.test.ts`. The db package is fully mocked, so no Postgres is needed. (If TypeScript complains about a `RawRecord` field, check the exact shape in `packages/shared/src/types.ts` and adjust the literal — do not weaken the test.)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@super-mcp/db", () => ({
  reapReclassifiedListing: vi.fn(async () => {}),
  resolveProduct: vi.fn(async () => "product-1"),
  upsertChain: vi.fn(async () => {}),
  upsertListing: vi.fn(async () => "listing-1"),
  upsertPromotion: vi.fn(async () => "promo-1"),
  upsertStore: vi.fn(async () => "store-1"),
  upsertStorePrice: vi.fn(async () => {}),
}));

import { upsertChain, upsertPromotion } from "@super-mcp/db";
import type { RawRecord } from "@super-mcp/shared";
import { Normalizer } from "./normalize.js";

function priceRecord(storeId: string): RawRecord {
  return {
    kind: "price",
    chainId: "7290058140886",
    storeId,
    itemCode: "7290000173199",
    itemType: 1,
    name: "חלב 3%",
    qty: 1,
    unit: "ליטר",
    isWeighted: false,
    price: 6.9,
    allowDiscount: true,
    currency: "ILS",
    ts: new Date("2026-07-16T08:00:00Z"),
    raw: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Normalizer", () => {
  it("upserts each chain only once per run", async () => {
    const n = new Normalizer("test");
    await n.apply([priceRecord("001"), priceRecord("002")]);
    expect(upsertChain).toHaveBeenCalledTimes(1);
  });

  it("normalizes promo item codes the same way as listing item codes", async () => {
    const promo: RawRecord = {
      kind: "promo",
      chainId: "7290058140886",
      storeId: "001",
      promoId: "1234",
      description: "2 ב-30",
      mechanic: { type: "n_for_price", params: { n: 2, price: 30 }, rawText: "2 ב-30" },
      itemCodes: ["07290000173199", "INTERNAL-42"],
      startTs: new Date("2026-07-01T00:00:00Z"),
      endTs: new Date("2026-08-01T00:00:00Z"),
      clubOnly: false,
      ts: new Date(),
      raw: {},
    };
    const n = new Normalizer("test");
    const stats = await n.apply([promo]);
    expect(stats.rowsError).toBe(0);
    expect(upsertPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ itemCodes: ["7290000173199", "INTERNAL-42"] }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: FAIL — `upsertChain` called 2 times, and promo itemCodes still `["07290000173199", ...]`.

- [ ] **Step 3: Implement**

In `services/ingestion/src/normalize.ts`:

a) Add `canonicalItemCode` to the import from `@super-mcp/shared`:

```ts
import {
  canonicalItemCode,
  computeUnitPrice,
  isGtinItem,
  normalizeGtin,
  type RawRecord,
} from "@super-mcp/shared";
```

b) Add a chain cache next to the existing store cache in the class:

```ts
export class Normalizer {
  private storeIds = new Map<string, string>(); // chainId:storeCode -> uuid
  private chainsUpserted = new Set<string>();
  private sourceId: string;
```

c) In `applyOne`, wrap the unconditional `upsertChain` call (currently right before the `switch`) in the cache check:

```ts
    const cleanChainId = record.chainId.replace(/\u0000/g, "");
    if (!this.chainsUpserted.has(cleanChainId)) {
      await upsertChain({
        id: cleanChainId,
        sourceId: this.sourceId,
        market: "IL",
        nameHe: names.he,
        nameEn: names.en,
      });
      this.chainsUpserted.add(cleanChainId);
    }
```

d) In the `"price"` branch, replace `const listingItemCode = gtin ?? itemCode;` with:

```ts
        const listingItemCode = canonicalItemCode(record.itemType, itemCode);
```

(`gtin` stays as-is — it is still needed for `resolveProduct` and the `reapReclassifiedListing` call. `canonicalItemCode` produces the identical value by construction.)

e) In the `"promo"` branch, replace the `itemCodes` line inside the `upsertPromotion` call:

```ts
          itemCodes: record.itemCodes.map((c) =>
            // Promo feeds don't carry ItemType; assume barcode-capable (type 1) so a
            // padded GTIN maps to the same key the listing row is stored under.
            canonicalItemCode(1, c.replace(/\u0000/g, "")),
          ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: PASS (new file plus the 5 existing ingestion test files).

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/normalize.ts services/ingestion/src/normalize.test.ts
git commit -m "fix(ingestion): match promo item codes to listing keys and cache chain upserts

Promo item codes now go through the same GTIN normalization as listing
item_code, so padded barcodes no longer produce promotion_item rows with
NULL listing_id. upsertChain now runs once per chain per run instead of
once per record.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Fix region false positives ("אזור" and substring city hints)

**Files:**
- Modify: `services/ingestion/src/regions.ts:137-166`
- Test: `services/ingestion/src/regions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("isStoreInIngestRegion", ...)` block in `services/ingestion/src/regions.test.ts`:

```ts
  it("does not treat 'אזור תעשייה' (industrial zone) as the town Azor", () => {
    // Store in Eilat whose NAME contains the word אזור:
    expect(
      isStoreInIngestRegion({ storeId: "1", city: "אילת", name: "רמי לוי אזור תעשייה" }),
    ).toBe(false);
    // City field that merely starts with אזור:
    expect(isStoreInIngestRegion({ storeId: "2", city: "אזור תעשייה ספיר" })).toBe(false);
    // The actual town of Azor (exact city match) stays covered:
    expect(isStoreInIngestRegion({ storeId: "3", city: "אזור" })).toBe(true);
  });

  it("matches city names inside store names only on word boundaries", () => {
    expect(isStoreInIngestRegion({ storeId: "1", name: "שופרסל דיל נתניה" })).toBe(true);
    expect(isStoreInIngestRegion({ storeId: "2", name: "שופרסל-נתניה" })).toBe(true);
    // "יהודה" contains "יהוד" as a substring but is not the city Yehud:
    expect(isStoreInIngestRegion({ storeId: "3", name: "מרכז יהודה הלוי" })).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: FAIL — the אזור-name store, the אזור-prefix city, and "מרכז יהודה הלוי" all currently return `true`.

- [ ] **Step 3: Implement**

In `services/ingestion/src/regions.ts`:

a) After the `COVERED_CITIES` definition, add:

```ts
/**
 * Covered-city tokens that are also common Hebrew words, so they must only ever
 * match as an EXACT city value — never by prefix or inside a store name.
 * "אזור" is the town of Azor but also the word for "zone" (אזור תעשייה).
 */
const AMBIGUOUS_CITY_TOKENS = new Set(["אזור"].map(normalizeCityKey));
```

b) Replace `cityAllowed`:

```ts
function cityAllowed(city: string | undefined): boolean {
  if (!city) return false;
  const key = normalizeCityKey(city);
  if (COVERED_CITIES.has(key)) return true;
  if (key.length < 3) return false;
  // Prefix match for variants like "תל אביב יפו - מרכז".
  for (const allowed of COVERED_CITIES) {
    if (AMBIGUOUS_CITY_TOKENS.has(allowed)) continue;
    if (key.startsWith(allowed) || allowed.startsWith(key)) return true;
  }
  return false;
}
```

c) Replace `nameHintsCoveredCity`:

```ts
/** Weak hint: store name contains a covered city as a whole word. */
function nameHintsCoveredCity(name: string | undefined): boolean {
  if (!name) return false;
  // Hyphens become spaces so "שופרסל-נתניה" still matches; padding gives boundaries.
  const key = ` ${normalizeCityKey(name).replace(/-/g, " ")} `;
  for (const city of COVERED_CITIES) {
    if (city.length < 3 || AMBIGUOUS_CITY_TOKENS.has(city)) continue;
    if (key.includes(` ${city.replace(/-/g, " ")} `)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: PASS, including the pre-existing regions tests (Tel Aviv, Eilat rejection, etc.).

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/regions.ts services/ingestion/src/regions.test.ts
git commit -m "fix(ingestion): stop region filter matching 'אזור תעשייה' stores as the town Azor

Ambiguous city tokens only match as exact city values, and name hints
require whole-word matches.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Fix the dead absolute-URL regex in Shufersal discovery

**Files:**
- Modify: `services/ingestion/src/adapters/shufersal.ts:54-63`
- Test (create): `services/ingestion/src/adapters/shufersal.test.ts`

- [ ] **Step 1: Extract the href-extraction into a testable function (refactor, no behavior change yet)**

In `services/ingestion/src/adapters/shufersal.ts`, add above `createShufersalAdapter`:

```ts
/** Extract candidate feed-file links (xml / xml.gz) from portal HTML. */
export function extractFeedHrefs(html: string): Set<string> {
  const hrefs = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']+\.xml(?:\.gz)?)["']/gi)) {
    hrefs.add(m[1]!);
  }
  for (const m of html.matchAll(/(https?:\/\/[^"'\\s]+(?:PriceFull|PromoFull|Stores)[^"'\\s]*\.xml(?:\.gz)?)/gi)) {
    hrefs.add(m[1]!);
  }
  for (const m of html.matchAll(/["'](\/?[A-Za-z0-9_./-]*(?:PriceFull|PromoFull|Stores)[^"']*\.xml(?:\.gz)?)["']/gi)) {
    hrefs.add(m[1]!);
  }
  return hrefs;
}
```

Then inside `discover()`, replace the three inline `for (const m of html.matchAll(...))` loops with:

```ts
          for (const href of extractFeedHrefs(html)) {
            hrefs.add(href);
          }
```

(Keep the buggy `\\s` for now — the test in Step 2 must fail first.)

- [ ] **Step 2: Write the failing test**

Create `services/ingestion/src/adapters/shufersal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractFeedHrefs } from "./shufersal.js";

describe("extractFeedHrefs", () => {
  it("extracts hrefs pointing at xml/gz feed files", () => {
    const html = `<a href="/prices/PriceFull7290027600007-001-202607170300.xml.gz">download</a>`;
    expect([...extractFeedHrefs(html)]).toContain(
      "/prices/PriceFull7290027600007-001-202607170300.xml.gz",
    );
  });

  it("extracts absolute URLs even when they contain the letter 's' (regex regression)", () => {
    // Not an href attribute, so only the absolute-URL pattern can catch it.
    const url =
      "https://pricesprod.blob.core.windows.net/PriceFull7290027600007-001-202607170300.xml.gz";
    const html = `<script>window.open('${url}')</script>`;
    expect([...extractFeedHrefs(html)]).toContain(url);
  });
});
```

- [ ] **Step 3: Run test to verify the regression test fails**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: first test PASSES (href regex), second test FAILS — `[^"'\\s]` excludes the letter "s", so the URL never matches.

- [ ] **Step 4: Fix the regex**

In `extractFeedHrefs`, change `[^"'\\s]` to `[^"'\s]` in both places on the absolute-URL pattern:

```ts
  for (const m of html.matchAll(/(https?:\/\/[^"'\s]+(?:PriceFull|PromoFull|Stores)[^"'\s]*\.xml(?:\.gz)?)/gi)) {
    hrefs.add(m[1]!);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/ingestion/src/adapters/shufersal.ts services/ingestion/src/adapters/shufersal.test.ts
git commit -m "fix(ingestion): Shufersal absolute-URL discovery regex excluded the letter s

The character class [^\"'\\\\s] in a regex literal matches 'not backslash
and not s' rather than 'not whitespace', so absolute feed URLs could
never match. Extracted extractFeedHrefs for testability.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Classify metadata-only ingest runs as degraded

**Files:**
- Modify: `services/ingestion/src/pipeline.ts`
- Test: `services/ingestion/src/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

In `services/ingestion/src/pipeline.test.ts`, update the `result()` helper to include the new field (default `1` keeps existing cases green):

```ts
function result(partial: Partial<PipelineResult>): PipelineResult {
  return {
    sourceId: "test",
    status: "success",
    filesDiscovered: 0,
    filesProcessed: 0,
    priceFilesDiscovered: 1,
    rowsOk: 0,
    rowsError: 0,
    ...partial,
  };
}
```

Then add inside `describe("classifyStatus", ...)`:

```ts
  it("degrades a metadata-only run (rows ingested but zero price/promo files selected)", () => {
    // e.g. Stores XML parse failed => region filter selected no PriceFull/PromoFull files,
    // so only store metadata was ingested. That must not report green.
    expect(
      classifyStatus(
        result({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 200, priceFilesDiscovered: 0 }),
      ),
    ).toBe("degraded");
  });
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: FAIL — TypeScript error on `priceFilesDiscovered` (field doesn't exist yet). That counts as the red step.

- [ ] **Step 3: Implement**

In `services/ingestion/src/pipeline.ts`:

a) Add the field to `PipelineResult`:

```ts
export interface PipelineResult {
  sourceId: string;
  status: "success" | "failed" | "empty" | "degraded";
  filesDiscovered: number;
  filesProcessed: number;
  /** PriceFull/PromoFull files selected at discover time; 0 means metadata-only. */
  priceFilesDiscovered: number;
  rowsOk: number;
  rowsError: number;
  errorSummary?: string;
}
```

b) Initialize it in the `result` literal inside `runPipeline` (`priceFilesDiscovered: 0,` next to `filesDiscovered: 0,`).

c) After `result.filesDiscovered = files.length;` add:

```ts
    result.priceFilesDiscovered = files.filter(
      (f) => f.kind === "pricesfull" || f.kind === "promosfull",
    ).length;
```

d) In `classifyStatus`, after the `rowsOk === 0` check, add:

```ts
  // Rows landed but no price/promo files were even selected (e.g. Stores XML
  // failed and the region filter matched nothing): metadata-only, not green.
  if (result.priceFilesDiscovered === 0) return "degraded";
```

e) In `runPipeline`, right after `result.status = classifyStatus(result);` (the success path, not the catch block), add an operator hint:

```ts
    if (result.status === "degraded" && result.priceFilesDiscovered === 0) {
      result.errorSummary =
        (result.errorSummary ? result.errorSummary + "; " : "") +
        "no price/promo files selected (stores feed failed or region matched no stores)";
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && pnpm --filter @super-mcp/ingestion test`
Expected: PASS — new test plus all 6 pre-existing `classifyStatus` cases.

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/pipeline.ts services/ingestion/src/pipeline.test.ts
git commit -m "fix(ingestion): report metadata-only runs as degraded instead of success

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Guard `upsertStorePrice` against stale feed replays

**Files:**
- Modify: `packages/db/src/repos.ts:242-287`

No vitest coverage here — `packages/db` has no test harness and the logic is SQL (`vitest run --passWithNoTests`). Verification is typecheck plus the manual SQL walkthrough below.

- [ ] **Step 1: Implement**

In `packages/db/src/repos.ts`, inside `upsertStorePrice`, make two changes:

a) Add a staleness guard to the upsert and capture whether it applied:

```ts
  const upsertRes = await q.query(
    `INSERT INTO store_price (
       listing_id, store_id, price, unit_price, currency, allow_discount, source_ts, ingested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (listing_id, store_id) DO UPDATE SET
       price = EXCLUDED.price,
       unit_price = EXCLUDED.unit_price,
       currency = EXCLUDED.currency,
       allow_discount = EXCLUDED.allow_discount,
       source_ts = EXCLUDED.source_ts,
       ingested_at = now()
     WHERE store_price.source_ts <= EXCLUDED.source_ts`,
    [
      input.listingId,
      input.storeId,
      input.price,
      input.unitPrice,
      input.currency ?? "ILS",
      input.allowDiscount ?? null,
      input.sourceTs,
    ],
  );
  // rowCount 0 => the conflict row was newer (stale replay); don't record history either.
  const applied = (upsertRes.rowCount ?? 0) > 0;
```

b) Change the history condition from `if (changed)` to `if (applied && changed)`. The existing `prev` SELECT and `changed` computation above stay exactly as they are.

- [ ] **Step 2: Typecheck and full test run**

Run: `pnpm test`
Expected: build succeeds, all suites pass (this function has no unit tests; the ingestion suite must stay green).

- [ ] **Step 3: Manual verification (requires a local DB with any ingested listing/store)**

Skip if no local DB is set up. With `psql "$DATABASE_URL"`, pick any existing pair and verify a stale write is ignored:

```sql
-- Note current price and source_ts:
SELECT price, source_ts FROM store_price LIMIT 1;
-- Take its listing_id/store_id, then simulate a stale replay (older source_ts, absurd price):
INSERT INTO store_price (listing_id, store_id, price, source_ts)
VALUES ('<listing_id>', '<store_id>', 999, now() - interval '30 days')
ON CONFLICT (listing_id, store_id) DO UPDATE SET
  price = EXCLUDED.price, source_ts = EXCLUDED.source_ts
WHERE store_price.source_ts <= EXCLUDED.source_ts;
-- Expect: INSERT 0 0, and the SELECT above returns the original price unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repos.ts
git commit -m "fix(db): ignore stale feed replays in upsertStorePrice

An archive replay or out-of-order ingest with an older source_ts no
longer overwrites the latest price or appends a bogus price_point.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Fix the misleading streaming comment and README gap

**Files:**
- Modify: `services/ingestion/src/pipeline.ts:117-119` (the comment above `normalizer.apply(...)`)
- Modify: `README.md` (line ~65, the region-filter/`SUPER_MCP_FULL` paragraph)

- [ ] **Step 1: Fix the pipeline comment**

Replace the comment block above the `normalizer.apply(adapter.parse(blob))` call:

```ts
        // NOTE: parse() is not a streaming parser today. fetch() buffers the whole
        // file and fast-xml-parser builds a full document, so peak memory is
        // bytes + decoded string + DOM + record array. apply() consumes records
        // one at a time so DB writes don't buffer further. A SAX/streaming parser
        // is the known fix if large PriceFull files OOM a small Cloud Run Job.
        const stats = await normalizer.apply(adapter.parse(blob));
```

- [ ] **Step 2: Document the default-mode chain cap in the README**

In `README.md`, find the line:

```
Disable with `SUPER_MCP_REGION_FILTER=0`. Use `SUPER_MCP_FULL=1` for more stores *within* that region.
```

and append to that paragraph:

```
Without `SUPER_MCP_FULL=1`, the Cerberus adapter also covers only its first 2 chains (Rami Levy, Yohananof), so a default local ingest is 2 chains x 2 stores.
```

- [ ] **Step 3: Full verification**

Run: `pnpm test`
Expected: build clean, all suites pass (shared 13+new, api 3, ingestion 25+new).

- [ ] **Step 4: Commit**

```bash
git add services/ingestion/src/pipeline.ts README.md
git commit -m "docs: correct streaming-parse comment and document default ingest chain cap

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Explicitly out of scope (known, deliberate deferrals)

- **True streaming XML parse** — the real fix for memory on full-region files; big change (SAX parser + async iteration through the adapters). Tracked by the corrected comment in Task 8.
- **Batched DB writes in the normalizer** — row-by-row awaits are the main ingest throughput limiter; Task 3's chain cache is the cheap win only.
- **Aligning PriceFull/PromoFull store selection** — `selectRegionalFeedFiles` caps the two kinds independently; usually aligned by construction, low impact.
- **FTPS `rejectUnauthorized: false`** (`cerberus.ts:63`) and the in-memory rate limiter (`auth.ts:55`) — acknowledged trade-offs, already commented in code.
- **`?api_key=` query-param auth** — works as designed for MCP clients; consider log-scrubbing before production.
