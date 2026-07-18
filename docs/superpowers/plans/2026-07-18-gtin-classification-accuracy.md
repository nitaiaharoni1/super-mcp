# GTIN Classification Accuracy Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop treating chain-local codes (RCN restricted-circulation barcodes, ItemType-0 internal codes, and invalid-length codes) as global GTINs, so unrelated items stop merging across chains and corrupting the core "compare prices across chains" feature.

**Architecture:** Tighten one pure function (`isGtinItem`) to GS1-valid GTINs only, then re-key affected listings/products via a full re-ingest (feeds are full-state). No SQL-mirror change is required — `isGtinItem` runs only in TS ingestion; `normalizeGtin`/`sqlNormalizeGtin` are unchanged.

**Tech Stack:** TypeScript monorepo (pnpm), Postgres, vitest.

---

## Measured impact (live DB, 2026-07-18, 116,347 GTIN products)

| Signal | Count | Meaning |
|---|---|---|
| Products with a GTIN | 116,347 | baseline |
| GTIN is RCN (prefix `2`, restricted-circulation) | 474 | should never be cross-chain identity |
| **RCN products merged across >1 chain** | **90** | **confirmed corrupt cross-chain merges** |
| GTIN length ∉ {8,12,13,14} (9/10/11-digit) | ~2,758 | not valid GTINs; came from the `>=8 && <=14` accept |
| **Short-GTIN (<12) products merged across >1 chain** | **~1,354** | suspect merges (excl. legit EAN-8) |

Net: ~1,444 products (~1.2%) are suspect cross-chain merges. On each, `compare_prices` presents unrelated per-chain items as the same product — silent, and exactly the "accuracy" failure the project cares about.

## PRECONDITION (hard gate)

`packages/shared/src/utils/units.ts` and its test are currently **dirty** (concurrent agent's active work). Do NOT start until they commit and `git status` shows both clean. Re-anchor `isGtinItem` by symbol, not line number.

## Why no SQL-mirror change is needed

`isGtinItem` is called only in `services/ingestion/src/normalize.ts` (to decide `is_gtin` + whether to compute `gtin`). The stored columns `is_gtin`, `gtin`, `item_code`, and `item_code_norm` are written by TS at ingest time. `sqlNormalizeGtin`/`item_code_norm` normalize a code's digits and are unchanged by this fix. Verified callers of `isGtinItem`: only `canonicalItemCode` (same file) and `normalize.ts:161`. Callers of `normalizeGtin` (API search paths, `gtinSql.ts`) are unaffected — they normalize a query GTIN and keep working.

---

### Task 1: Tighten `isGtinItem` to GS1-valid, non-RCN, ItemType-1 codes

**Files:**
- Modify: `packages/shared/src/utils/units.ts` (`isGtinItem`)
- Test: `packages/shared/tests/utils/units.test.ts` (extend)

- [ ] **Step 1: Failing tests** (extend the existing units.test.ts describe block)

```ts
describe("isGtinItem (GS1-valid, non-RCN, barcode only)", () => {
  it("accepts real EAN-13 / UPC-A / EAN-8 barcodes (type 1)", () => {
    expect(isGtinItem(1, "7290000000001")).toBe(true);   // EAN-13 (Israel 729)
    expect(isGtinItem(1, "036000291452")).toBe(true);     // UPC-A (12)
    expect(isGtinItem(1, "96385074")).toBe(true);          // EAN-8
    expect(isGtinItem(1, "00007290000000001")).toBe(true); // zero-padded GTIN-14
  });
  it("rejects ItemType-0 internal codes even at GTIN lengths", () => {
    expect(isGtinItem(0, "7290000000001")).toBe(false);
    expect(isGtinItem(0, "1234567890123")).toBe(false);
  });
  it("rejects RCN restricted-circulation codes (GS1 prefix 2)", () => {
    expect(isGtinItem(1, "2000000000001")).toBe(false);   // in-store variable weight
    expect(isGtinItem(1, "0200000000001")).toBe(false);   // padded RCN
    expect(isGtinItem(1, "29123456")).toBe(false);         // RCN EAN-8
  });
  it("rejects non-GTIN lengths (9/10/11 digits)", () => {
    expect(isGtinItem(1, "123456789")).toBe(false);
    expect(isGtinItem(1, "12345678901")).toBe(false);
  });
  it("rejects alphanumeric internal codes", () => {
    expect(isGtinItem(1, "AB-42")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — confirm the RCN/type-0/odd-length cases FAIL against current code**

Run: `pnpm --filter @super-mcp/shared exec vitest run tests/utils/units.test.ts`
Expected: the RCN, type-0-at-GTIN-length, and 9/11-digit cases fail (current code returns true).

- [ ] **Step 3: Implement**

```ts
export function isGtinItem(itemType: number, itemCode: string): boolean {
  // Only ItemType 1 (ברקוד) carries a real barcode. ItemType 0 (פנימי) is a
  // chain-internal code by the Israeli price-feed spec and must never become
  // cross-chain product identity.
  if (itemType !== 1) return false;
  const digits = itemCode.replace(/\D/g, "");
  // Compare on the GS1-normalized form (leading zeros are pad, per normalizeGtin).
  const norm = digits.replace(/^0+/, "");
  const len = norm.length >= 8 ? norm.length : digits.length;
  // Valid GTIN lengths only: EAN-8, UPC-A(12), EAN-13, GTIN-14. Reject 9/10/11.
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) return false;
  // GS1 prefix 2 (and padded 02x) is Restricted Circulation: in-store,
  // variable-weight, chain-local. Never globally unique — exclude from GTIN.
  if (/^2/.test(norm)) return false;
  return true;
}
```

Update the stale comment above the function.

- [ ] **Step 4: Run — full shared suite green**

Run: `pnpm --filter @super-mcp/shared exec vitest run`
Expected: PASS. If an existing units test asserted the OLD permissive behavior (e.g. a type-0 13-digit code classified as GTIN), that assertion encoded the bug — update it and note it.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/utils/units.ts packages/shared/tests/utils/units.test.ts
git commit -m "fix(shared): classify only GS1-valid non-RCN ItemType-1 codes as GTIN

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Impact guard script (before/after measurement)

**Files:**
- Create: `packages/db/src/scripts/gtinAudit.ts`
- Add script: `packages/db/package.json` → `"gtin-audit": "tsx src/scripts/gtinAudit.ts"`

- [ ] **Step 1: Implement the read-only audit** (prints the four metrics from the impact table)

```ts
import { getPool, closePool } from "../client/index.js";

async function main() {
  const q = (s: string) => getPool().query(s).then((r) => r.rows);
  const total = (await q("SELECT count(*) c FROM product WHERE gtin IS NOT NULL"))[0].c;
  const rcnMerged = (await q(
    `SELECT count(*) c FROM (
       SELECT p.id FROM product p JOIN listing l ON l.product_id = p.id
       WHERE p.gtin ~ '^0*2[0-9]{5,}'
       GROUP BY p.id HAVING count(DISTINCT l.chain_id) > 1) x`,
  ))[0].c;
  const shortMerged = (await q(
    `SELECT count(*) c FROM (
       SELECT p.id FROM product p JOIN listing l ON l.product_id = p.id
       WHERE length(p.gtin) < 12
       GROUP BY p.id HAVING count(DISTINCT l.chain_id) > 1) x`,
  ))[0].c;
  console.log(JSON.stringify({ event: "gtin_audit", gtinProducts: total, rcnMergedAcrossChains: rcnMerged, shortMergedAcrossChains: shortMerged }));
  await closePool();
}
main();
```

- [ ] **Step 2: Baseline run (before re-ingest)**

Run: `pnpm --filter @super-mcp/db exec tsx src/scripts/gtinAudit.ts`
Record: `rcnMergedAcrossChains` (~90) and `shortMergedAcrossChains` (~1354) as the "before".

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/scripts/gtinAudit.ts packages/db/package.json
git commit -m "feat(db): gtin-audit script to measure cross-chain merge corruption

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Re-ingest to re-key affected listings and split merged products

The code fix only changes FUTURE classification. Existing rows keep their old keys until re-ingested. Feeds are full-state (PriceFull/PromoFull), so a full re-ingest re-runs `normalize` under the new classification. `reapReclassifiedListing` (with the digit-length guard) handles the per-listing flip: an RCN item flips from `is_gtin=true` (keyed on `normalizeGtin`, 13 digits ≥ 8 → guard passes) to chain-scoped (`sourceKey`), and the stale GTIN-keyed listing is reaped.

**This is an operational step; run in a maintenance window against production, staging first.**

- [ ] **Step 1: Snapshot the audit baseline** (Task 2 numbers).

- [ ] **Step 2: Full re-ingest of all sources**

Run: the production ingest for every source (or `pnpm ingest` per source). Full feeds re-key every item.

- [ ] **Step 3: Reap orphaned merged products**

After re-ingest, a formerly-merged RCN/short product may be left with listings from only one chain (the flips re-pointed the others to new chain-scoped products) or none. Delete products with zero remaining listings:

```sql
DELETE FROM product p
WHERE NOT EXISTS (SELECT 1 FROM listing l WHERE l.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM product_embedding e WHERE e.product_id = p.id);
-- (embedding/profile rows cascade or are drained on next semantic pass)
```

Verify FK cascade behavior first (`price_point`, `store_price`, `product_semantic_profile`, `product_embedding`). Wrap in a transaction; count before/after.

- [ ] **Step 4: Re-run the audit; confirm corruption dropped**

Run: `pnpm --filter @super-mcp/db exec tsx src/scripts/gtinAudit.ts`
Expected: `rcnMergedAcrossChains` → 0 (RCN codes are now chain-scoped, never merged); `shortMergedAcrossChains` → only legitimate EAN-8 shared products remain (a small residual is fine and expected — real 8-digit GTINs sold at multiple chains).

- [ ] **Step 5: Spot-check** a few of the previously-merged product ids: each chain's item should now be its own product with its own listings, and `compare_prices` on any single one no longer shows unrelated cross-chain rows.

---

## Regression guards

- **Do not over-demote.** Real EAN-8 (8-digit, non-prefix-2) barcodes ARE valid global GTINs — Task 1 keeps them. The audit's residual `shortMergedAcrossChains` after re-ingest should be small and legitimate, not zero.
- **Verify legit GTIN count stays ~stable.** Before/after `count(*) FROM product WHERE gtin IS NOT NULL` should drop by roughly the ~1,444 corrupt-merge products being split/rescoped, NOT by a large fraction. A big drop means the classifier is wrongly demoting real barcodes — stop and investigate.
- **`item_code_norm` / `sqlNormalizeGtin` unchanged** — confirm promotions join (`activePromotions.ts`) still resolves after re-ingest.

## Coordination

- Land Task 1 only after the concurrent agent's `units.ts` work commits (precondition gate).
- Tasks 2 and non-`units.ts` parts are independent and can land anytime.
- The re-ingest (Task 3) is the heavy operational step; schedule it deliberately.

## Out of scope

- `normalizeGtin` GTIN-8-vs-zero-padded-GTIN-12 conflation (separate minor finding).
- Weighted-item price-per-kg handling (separate).
