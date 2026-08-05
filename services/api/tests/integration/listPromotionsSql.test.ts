/**
 * Executes the get_promotions SQL against a real Postgres.
 *
 * The unit suite for this module mocks the driver and asserts on the bind array,
 * which cannot see a statement the server refuses to parse. That gap shipped a
 * total outage: the browse path bound $2 without referencing it, Postgres
 * answered `could not determine data type of parameter $2`, and every
 * get_promotions call in production returned "Internal server error" while the
 * mocked tests stayed green. These cases exist to make the SQL itself reachable
 * by a test, so the next unreferenced placeholder or renamed column fails here
 * instead of in a shopper's chat.
 *
 * Assertions stay shape-only on purpose. Which promotions a live catalogue holds
 * changes nightly; that the query parses, binds and returns rows does not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPromotions } from "../../src/services/promotions/listPromotions.js";
import {
  closeLivePool,
  liveCatalogSkipReason,
  liveDbConfigured,
  probeLiveCatalog,
  type LiveCatalogStats,
} from "./helpers/liveEnv.js";

const LIVE = liveDbConfigured();

describe.skipIf(!LIVE)("listPromotions SQL (live DB)", () => {
  let stats: LiveCatalogStats | null = null;

  beforeAll(async () => {
    stats = await probeLiveCatalog();
    if (!stats) console.warn(`skipping: ${liveCatalogSkipReason()}`);
  });

  afterAll(async () => {
    await closeLivePool();
  });

  // Each of these took a different route through the shared filters, and all four
  // failed identically before the fix, so a single case would not have told us
  // whether the browse path or one particular filter was at fault.
  const browseCases: Array<[string, Parameters<typeof listPromotions>[0]]> = [
    ["no filters at all", { limit: 3 }],
    ["Hebrew city", { city: "תל אביב", limit: 3 }],
    ["English city", { city: "Tel Aviv", limit: 3 }],
    ["explicitly inactive", { activeOnly: false, limit: 2 }],
  ];

  for (const [label, params] of browseCases) {
    it(`browse path parses and binds: ${label}`, async () => {
      if (!stats) return;
      const rows = await listPromotions(params);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeLessThanOrEqual(params.limit ?? 50);
      for (const row of rows) {
        expect(typeof row.id).toBe("string");
        expect(typeof row.chainId).toBe("string");
        expect(Array.isArray(row.itemCodes)).toBe(true);
      }
    });
  }

  // The product-scoped path is the one that DID work, and it is the reason $2 has
  // to keep its position at all. Pinning it here means a future cleanup of the
  // unused bind cannot quietly break the path it was protecting.
  it("product-scoped path still parses with a real product id", async () => {
    if (!stats) return;
    const { query } = await import("@super-mcp/db");
    const found = await query<{ id: string }>(
      `SELECT p.id
         FROM product p
         JOIN listing l ON l.product_id = p.id
        WHERE l.item_code <> ''
        LIMIT 1`,
    );
    const productId = found.rows[0]?.id;
    if (!productId) return;

    const rows = await listPromotions({ productId, limit: 3 });
    expect(Array.isArray(rows)).toBe(true);
  });
});
