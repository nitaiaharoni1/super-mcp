/**
 * Additional live MCP edge / multi-step flows — no mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BasketOptimizeResult } from "../../src/services/basket/types.js";
import {
  assertCompleteBasket,
  assertPricedPlan,
  pickConfirmationAnswers,
} from "./helpers/assertions.js";
import { FIXTURE_CITY, FIXTURE_LOCATION } from "./helpers/fixtureBasket.js";
import {
  closeLivePool,
  isFullCatalog,
  liveCatalogSkipReason,
  liveDbConfigured,
  probeLiveCatalog,
  type LiveCatalogStats,
} from "./helpers/liveEnv.js";
import { createMcpHarness, type McpHarness } from "./helpers/mcpHarness.js";

const LIVE = liveDbConfigured();

describe.skipIf(!LIVE)("MCP edge flows (live DB)", () => {
  let mcp: McpHarness;
  let skipReason: string | null = null;
  let stats: LiveCatalogStats | null = null;

  beforeAll(async () => {
    stats = await probeLiveCatalog();
    if (!stats) {
      skipReason = liveCatalogSkipReason();
      return;
    }
    mcp = createMcpHarness();
  }, 30_000);

  afterAll(async () => {
    await closeLivePool();
  });

  function requireLive(skip: (condition: boolean, reason?: string) => void): void {
    skip(Boolean(skipReason), skipReason ?? "live catalog unavailable");
  }

  it(
    "GTIN path: search → optimize with product_id pin",
    async ({ skip }) => {
      requireLive(skip);

      const search = await mcp.call<{
        products: Array<{ id: string; gtin: string | null; name: string }>;
      }>("search_products", {
        query: "חלב תנובה",
        city: FIXTURE_CITY,
        limit: 5,
        in_stock_only: true,
      });
      expect(search.products.length).toBeGreaterThan(0);

      const withGtin = search.products.find((p) => p.gtin);
      expect(withGtin, "expected a GTIN-bearing milk hit").toBeTruthy();

      const byGtin = await mcp.call<{
        products: Array<{ id: string; gtin: string | null }>;
      }>("search_products", { gtin: withGtin!.gtin! });
      expect(byGtin.products.some((p) => p.id === withGtin!.id)).toBe(true);

      const basket = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [
          { product_id: withGtin!.id, pack_qty: 2 },
          { query: "לחם", pack_qty: 1 },
          { query: "אורז", pack_qty: 1 },
        ],
        city: FIXTURE_CITY,
        resolution_mode: "fast",
        response_detail: "standard",
      });

      assertCompleteBasket(basket);
      assertPricedPlan(basket.bestSingleStore, "bestSingleStore");
      expect(basket.items.some((i) => i.index === 0 && i.productId === withGtin!.id)).toBe(true);
    },
    60_000,
  );

  it(
    "strict small basket: resume only with continuation + answers",
    async ({ skip }) => {
      requireLive(skip);

      const first = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [
          { query: "חומוס", pack_qty: 1 },
          { query: "טחינה", pack_qty: 1 },
          { query: "קפה", pack_qty: 1 },
        ],
        city: isFullCatalog(stats) ? "הרצליה" : FIXTURE_CITY,
        resolution_mode: "strict",
        response_detail: "standard",
      });

      if (first.status === "needs_confirmation") {
        const err = await mcp.callExpectError("optimize_basket", {
          continuation: first.continuation,
          answers: pickConfirmationAnswers(first),
          city: FIXTURE_CITY,
        });
        expect(err).toMatch(/only continuation and answers/i);

        const done = await mcp.call<BasketOptimizeResult>("optimize_basket", {
          continuation: first.continuation,
          answers: pickConfirmationAnswers(first),
        });
        assertCompleteBasket(done);
        assertPricedPlan(done.bestSingleStore, "bestSingleStore");
      } else {
        assertCompleteBasket(first);
        assertPricedPlan(first.bestSingleStore, "bestSingleStore");
      }
    },
    60_000,
  );

  it(
    "near=lat,lng scopes stores and basket without a city string",
    async ({ skip }) => {
      requireLive(skip);

      // Dizengoff / Tel Aviv (seed store coords)
      const near = "32.078,34.774";
      const stores = await mcp.call<{ stores: Array<{ id: string; distanceKm: number | null }> }>(
        "list_stores",
        { near, radius_km: 8 },
      );
      expect(stores.stores.length).toBeGreaterThan(0);
      const withDistance = stores.stores.filter((s) => s.distanceKm != null);
      expect(withDistance.length).toBeGreaterThan(0);
      for (const s of withDistance) {
        expect(s.distanceKm!).toBeLessThanOrEqual(8.01);
      }

      const basket = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [
          { query: "חלב תנובה", pack_qty: 1 },
          { query: "לחם אחיד", pack_qty: 1 },
        ],
        near,
        radius_km: 8,
        resolution_mode: "fast",
        response_detail: "standard",
      });
      assertCompleteBasket(basket);
      // Coordinate-only scope can yield sparse stock; accept priced plan or explicit omissions.
      if (basket.bestSingleStore) {
        assertPricedPlan(basket.bestSingleStore, "bestSingleStore");
      } else {
        expect(
          (basket.assumptions?.length ?? 0) + (basket.omittedItems?.length ?? 0),
        ).toBeGreaterThan(0);
      }
    },
    45_000,
  );

  it(
    "compare_prices unit_price sort contract",
    async ({ skip }) => {
      requireLive(skip);

      const search = await mcp.call<{ products: Array<{ id: string }> }>("search_products", {
        query: "אורז",
        city: FIXTURE_CITY,
        limit: 3,
        in_stock_only: true,
      });
      expect(search.products.length).toBeGreaterThan(0);
      const productId = search.products[0]!.id;

      const byPrice = await mcp.call<{
        sort: string;
        prices: Array<{ effectivePrice: number; unitPrice?: number | null }>;
      }>("compare_prices", {
        product_id: productId,
        location: FIXTURE_LOCATION,
        sort: "price",
      });
      expect(byPrice.sort).toBe("price");
      expect(byPrice.prices.length).toBeGreaterThan(0);

      const byUnit = await mcp.call<{
        sort: string;
        prices: Array<{ effectivePrice: number; unitPrice?: number | null }>;
      }>("compare_prices", {
        product_id: productId,
        location: FIXTURE_LOCATION,
        sort: "unit_price",
      });
      expect(byUnit.sort).toBe("unit_price");
      expect(byUnit.prices.length).toBeGreaterThan(0);
    },
    45_000,
  );

  it("unknown tool args are rejected by strict schema", async ({ skip }) => {
    requireLive(skip);

    await expect(
      mcp.call("search_products", { query: "חלב", not_a_real_field: true }),
    ).rejects.toThrow();
  });
});
