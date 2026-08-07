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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLexicalRankedCte } from "../../../src/services/search/lexicalSql.js";
import { searchProductsScored } from "../../../src/services/search/index.js";
import { query } from "@super-mcp/db";
import {
  closeLivePool,
  isFullCatalog,
  liveCatalogSkipReason,
  probeLiveCatalog,
  type LiveCatalogStats,
} from "../../integration/helpers/liveEnv.js";

describe("tie-break among equally-scored name matches", () => {
  it("orders by how widely a product is stocked, not by the alphabet", () => {
    const sql = buildLexicalRankedCte();
    expect(sql).toContain("p.store_count DESC");
    // Score still dominates; popularity only breaks ties within a score tier.
    expect(sql).toMatch(/ORDER BY\s+score DESC,\s*p\.store_count DESC/);
  });

  it("keeps a deterministic final tiebreak so results never reorder run to run", () => {
    expect(buildLexicalRankedCte()).toMatch(
      /p\.store_count DESC,\s*p\.name ASC/,
    );
  });
});

describe("generic staple queries retrieve the staple (live DB)", () => {
  // The pool is 20 wide; a mainstream staple has to be in it.
  const STAPLES = ["שמן", "יוגורט", "פסטה", "קפה", "קמח"];

  // Needs the real catalog. CI runs an ephemeral Postgres holding only fixture
  // rows, where no product is stocked in 100 stores because there are not 100
  // stores, so without this guard these fail for the wrong reason.
  let stats: LiveCatalogStats | null = null;
  beforeAll(async () => {
    stats = await probeLiveCatalog();
  }, 30_000);
  afterAll(async () => {
    await closeLivePool();
  });

  for (const q of STAPLES) {
    it(`retrieves a widely stocked product for ${q}`, async ({ skip }) => {
      skip(!isFullCatalog(stats), liveCatalogSkipReason());
      const hits = await searchProductsScored({ q, limit: 20 });
      expect(hits.length).toBeGreaterThan(0);

      const pool = await query<{ n: number }>(
        `SELECT COALESCE(max(store_count), 0)::int AS n
           FROM product WHERE id = ANY($1::uuid[])`,
        [hits.map((h) => h.id)],
      );
      // What the pool COULD have contained: the query scores a name-prefix match
      // at 0.95 flat, so every one of these was equally eligible.
      const catalogue = await query<{ n: number }>(
        `SELECT COALESCE(max(store_count), 0)::int AS n
           FROM product WHERE name LIKE $1`,
        [`${q}%`],
      );

      const poolBest = Number(pool.rows[0]?.n ?? 0);
      const catalogueBest = Number(catalogue.rows[0]?.n ?? 0);
      expect(catalogueBest, `no product in the catalogue starts with ${q}`).toBeGreaterThan(0);

      // Measured as a share of what was reachable, not an absolute count. The
      // original assertion wanted >100 stores, which was ~11% of the 898
      // branches this ran against and is unreachable now the ingest keeps ~53
      // storefronts: it would fail on a perfect pool. The defect it guards is a
      // RECALL gap, and a ratio states it directly. Before the fix these pools
      // topped out at 8 of a reachable 99 (0.08); all five now measure 1.00.
      expect(
        poolBest / catalogueBest,
        `pool best ${poolBest} vs catalogue best ${catalogueBest} for ${q}`,
      ).toBeGreaterThanOrEqual(0.5);
    });
  }
});
