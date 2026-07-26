/**
 * A generic staple query must retrieve the staple.
 *
 * Every product whose name STARTS with the query word scores exactly 0.95, so a
 * one-word query like "שמן" ties hundreds of products. The tiebreak was
 * `p.name ASC`, which is the Hebrew alphabet, and the pool is then cut at 20.
 * The shopper got an alphabet lottery:
 *
 *   שמן  ->  שמן אבטיח, שמן אורגנו פראי, שמן ארגאן, שמן ארומטי לימון
 *
 * Watermelon, oregano, argan and lemon oil. Meanwhile שמן קנולה (747 stores)
 * and שמן חמניות (398) were never candidates at all, so no downstream ranking
 * or availability upgrade could recover them: `betterCoveredPeer` can only
 * choose among candidates it was handed, and the best one it ever saw was
 * stocked in 8 stores.
 *
 * Measured before the fix, best-stocked product IN the retrieved pool versus
 * the best in the catalog:
 *
 *   יוגורט   7 stores retrieved   vs  99, 96, 96 in catalog, none retrieved
 *   שמן      8 stores retrieved   vs  99, 99, 97 in catalog, none retrieved
 *   פסטה    17 stores retrieved   vs  99, 98, 97 in catalog, none retrieved
 *
 * This is a recall defect, not a ranking one, and it is the mechanism behind
 * "21 of the 24 benchmark failures are a correctly-identified product that is
 * thinly stocked".
 */
import { describe, expect, it } from "vitest";
import { buildLexicalRankedCte } from "../../../src/services/search/lexicalSql.js";
import { searchProductsScored } from "../../../src/services/search/index.js";
import { query } from "@super-mcp/db";

describe("tie-break among equally-scored name matches", () => {
  it("orders by how widely a product is stocked, not by the alphabet", () => {
    const sql = buildLexicalRankedCte();
    expect(sql).toContain("p.store_count DESC");
    // Score still dominates; popularity only breaks ties within a score tier.
    expect(sql).toMatch(/ORDER BY\s+score DESC,\s*p\.store_count DESC/);
  });

  it("keeps a deterministic final tiebreak so results never reorder run to run", () => {
    expect(buildLexicalRankedCte()).toMatch(/p\.store_count DESC,\s*p\.name ASC/);
  });
});

describe("generic staple queries retrieve the staple (live DB)", () => {
  // The pool is 20 wide; a mainstream staple has to be in it.
  const STAPLES = ["שמן", "יוגורט", "פסטה", "קפה", "קמח"];

  it.each(STAPLES)("retrieves a widely stocked product for %s", async (q) => {
    const hits = await searchProductsScored({ q, limit: 20 });
    expect(hits.length).toBeGreaterThan(0);

    const counts = await query<{ id: string; store_count: number }>(
      `SELECT id, store_count FROM product WHERE id = ANY($1::uuid[])`,
      [hits.map((h) => h.id)],
    );
    const best = Math.max(0, ...counts.rows.map((r) => Number(r.store_count)));

    // Before the fix these pools topped out in the single digits or low teens
    // while 400+ store products sat un-retrieved.
    expect(best).toBeGreaterThan(100);
  });
});
