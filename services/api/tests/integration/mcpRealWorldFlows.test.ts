/**
 * Live MCP real-world flows — no mocks.
 *
 * Exercises the full registrar → Zod → service → Postgres path using the same
 * snake_case args an agent sends. Skips automatically when DATABASE_URL is
 * unset or the catalog is too small (typical in the lightweight CI `test` job).
 *
 * Fixture-sized catalogs (seed + ingest:fixture) run the core journeys.
 * Full Israel dumps also run BBQ / Neve Amal coverage.
 *
 * Run locally:
 *   pnpm --filter @super-mcp/api test:live
 *
 * Opt out: SUPER_MCP_SKIP_LIVE=1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTargetBranchCoverage } from "../../src/scripts/canary/assertTargetBranchCoverage.js";
import {
  BBQ_ITEMS,
  DEFAULT_NEVE_AMAL_STORE_ID,
} from "../../src/scripts/canary/bbqBasketFixture.js";
import {
  FORBIDDEN_FAST_SELECTIONS,
  TEL_AVIV_LOCATION,
  TEL_AVIV_STAPLES_ITEMS,
} from "../../src/scripts/canary/telAvivStaplesFixture.js";
import type { BasketOptimizeResult } from "../../src/services/basket/types.js";
import {
  assertCompleteBasket,
  assertNoForbiddenSelections,
  assertPricedPlan,
  pickConfirmationAnswers,
} from "./helpers/assertions.js";
import {
  FIXTURE_CITY,
  FIXTURE_FORBIDDEN_NAMES,
  FIXTURE_LOCATION,
  FIXTURE_STAPLES_MCP_ITEMS,
} from "./helpers/fixtureBasket.js";
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

function toMcpItems(
  items: Array<{
    query?: string;
    gtin?: string;
    productId?: string;
    packQty?: number;
    amount?: number;
    unit?: string;
  }>,
) {
  return items.map((item) => ({
    ...(item.productId ? { product_id: item.productId } : {}),
    ...(item.gtin ? { gtin: item.gtin } : {}),
    ...(item.query ? { query: item.query } : {}),
    ...(item.packQty != null ? { pack_qty: item.packQty } : {}),
    ...(item.amount != null ? { amount: item.amount } : {}),
    ...(item.unit != null ? { unit: item.unit } : {}),
  }));
}

describe.skipIf(!LIVE)("MCP real-world flows (live DB)", () => {
  let mcp: McpHarness;
  let skipReason: string | null = null;
  let stats: LiveCatalogStats | null = null;

  beforeAll(async () => {
    stats = await probeLiveCatalog();
    if (!stats) {
      skipReason = liveCatalogSkipReason();
      console.warn(`[live] skipping MCP flows: ${skipReason}`);
      return;
    }
    console.info(`[live] catalog ready`, stats);
    mcp = createMcpHarness();
  }, 30_000);

  afterAll(async () => {
    await closeLivePool();
  });

  function requireLive(skip: (condition: boolean, reason?: string) => void): void {
    skip(Boolean(skipReason), skipReason ?? "live catalog unavailable");
  }

  function requireFull(skip: (condition: boolean, reason?: string) => void): void {
    requireLive(skip);
    skip(!isFullCatalog(stats), "full catalog required (BBQ / Neve Amal coverage)");
  }

  it("registers the full public MCP tool surface", ({ skip }) => {
    requireLive(skip);
    expect(mcp.toolNames()).toEqual(
      expect.arrayContaining([
        "optimize_basket",
        "search_products",
        "get_product",
        "compare_prices",
        "suggest_substitutes",
        "resolve_products",
        "list_stores",
        "get_promotions",
      ]),
    );
    expect(mcp.toolNames()[0]).toBe("optimize_basket");
  });

  it(
    "fixture staples: one-call complete basket in Tel Aviv",
    async ({ skip }) => {
      requireLive(skip);

      const result = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [...FIXTURE_STAPLES_MCP_ITEMS],
        city: FIXTURE_CITY,
        resolution_mode: "fast",
        response_detail: "summary",
      });

      assertCompleteBasket(result);
      assertPricedPlan(result.bestSingleStore, "bestSingleStore");
      expect(result.items.length).toBe(FIXTURE_STAPLES_MCP_ITEMS.length);
      const payload = JSON.stringify(result);
      for (const name of FIXTURE_FORBIDDEN_NAMES) {
        expect(payload).not.toContain(name);
      }
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThan(20_000);
    },
    45_000,
  );

  it(
    "location free-text scopes list_stores then optimize_basket",
    async ({ skip }) => {
      requireLive(skip);

      const stores = await mcp.call<{
        stores: Array<{ id: string; name: string; city: string | null }>;
        location: unknown;
      }>("list_stores", {
        location: FIXTURE_LOCATION,
        radius_km: 10,
      });

      expect(stores.stores.length).toBeGreaterThan(0);
      expect(stores.location).toBeTruthy();

      const basket = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [
          { query: "חלב", pack_qty: 2 },
          { query: "לחם", pack_qty: 1 },
          { query: "עגבניות", amount: 1, unit: "kg" },
        ],
        location: FIXTURE_LOCATION,
        resolution_mode: "fast",
        response_detail: "standard",
      });

      assertCompleteBasket(basket);
      assertPricedPlan(basket.bestSingleStore, "bestSingleStore");
    },
    45_000,
  );

  it(
    "quantity dialects: pack_qty, pack_qty+יח, and amount+unit",
    async ({ skip }) => {
      requireLive(skip);

      const result = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [
          { query: "חלב", pack_qty: 3 },
          { query: "ביצים", pack_qty: 1, unit: "יח" },
          { query: "עגבניות", amount: 1.5, unit: "kg" },
          { query: "שמן", amount: 1, unit: "L" },
        ],
        city: FIXTURE_CITY,
        resolution_mode: "fast",
      });

      assertCompleteBasket(result);
      expect(result.items.length).toBe(4);
      assertPricedPlan(result.bestSingleStore, "bestSingleStore");
    },
    45_000,
  );

  it(
    "product discovery chain: search → get → compare → promotions → substitutes",
    async ({ skip }) => {
      requireLive(skip);

      const search = await mcp.call<{
        products: Array<{ id: string; name: string; gtin: string | null }>;
      }>("search_products", {
        query: "חלב תנובה",
        city: FIXTURE_CITY,
        limit: 5,
        in_stock_only: true,
      });

      expect(search.products.length).toBeGreaterThan(0);
      const productId = search.products[0]!.id;
      expect(productId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      const detail = await mcp.call<{
        product: { id: string; name: string };
      }>("get_product", { product_id: productId });
      expect(detail.product.id).toBe(productId);
      expect(detail.product.name.length).toBeGreaterThan(0);

      const prices = await mcp.call<{
        product_id: string;
        prices: Array<{ storeId: string; effectivePrice: number; listPrice: number }>;
      }>("compare_prices", {
        product_id: productId,
        city: FIXTURE_CITY,
        sort: "price",
      });
      expect(prices.product_id).toBe(productId);
      expect(prices.prices.length).toBeGreaterThan(0);
      expect(prices.prices[0]!.effectivePrice).toBeGreaterThan(0);
      for (let i = 1; i < prices.prices.length; i++) {
        expect(prices.prices[i]!.effectivePrice).toBeGreaterThanOrEqual(
          prices.prices[i - 1]!.effectivePrice,
        );
      }

      const promos = await mcp.call<{ promotions: unknown[] }>("get_promotions", {
        product_id: productId,
        city: FIXTURE_CITY,
        active: true,
        limit: 20,
      });
      expect(Array.isArray(promos.promotions)).toBe(true);

      const subs = await mcp.call<Record<string, unknown>>("suggest_substitutes", {
        product_id: productId,
        city: FIXTURE_CITY,
        limit: 5,
        cheaper_only: true,
      });
      expect(subs).toBeTruthy();
    },
    60_000,
  );

  it(
    "resolve_products batch-disambiguates Hebrew staples",
    async ({ skip }) => {
      requireLive(skip);

      const resolved = await mcp.call<{
        results: Array<{
          index: number;
          query: string | null;
          candidates: Array<{ id: string; name: string }>;
        }>;
      }>("resolve_products", {
        queries: [
          { query: "חלב", limit: 5 },
          { query: "קוטג'", limit: 5 },
          { query: "אורז", limit: 5 },
        ],
        city: FIXTURE_CITY,
      });

      expect(resolved.results).toHaveLength(3);
      for (const row of resolved.results) {
        expect(row.candidates.length).toBeGreaterThan(0);
        expect(row.candidates[0]!.id).toBeTruthy();
        expect(row.candidates[0]!.name.length).toBeGreaterThan(0);
      }
    },
    45_000,
  );

  it(
    "Hebrew search hits the catalog; English works on full dumps",
    async ({ skip }) => {
      requireLive(skip);

      const milk = await mcp.call<{ products: Array<{ id: string; name: string }> }>(
        "search_products",
        { query: "חלב", city: FIXTURE_CITY, limit: 5 },
      );
      expect(milk.products.length).toBeGreaterThan(0);

      const oil = await mcp.call<{ products: Array<{ id: string; name: string }> }>(
        "search_products",
        { query: "שמן זית", limit: 5 },
      );
      expect(oil.products.length).toBeGreaterThan(0);

      if (isFullCatalog(stats)) {
        const olive = await mcp.call<{ products: Array<{ id: string; name: string }> }>(
          "search_products",
          { query: "olive oil", limit: 5 },
        );
        expect(olive.products.length).toBeGreaterThan(0);
      }
    },
    30_000,
  );

  it("rejects resume anti-patterns the way agents hit them", async ({ skip }) => {
    requireLive(skip);

    const badResume = await mcp.callExpectError("optimize_basket", {
      continuation: "not-a-real-token",
      answers: [{ item_index: 0, product_id: "00000000-0000-4000-8000-000000000001" }],
      items: [{ query: "חלב", pack_qty: 1 }],
    });
    expect(badResume).toMatch(/only continuation and answers/i);

    const answersAlone = await mcp.callExpectError("optimize_basket", {
      answers: [{ item_index: 0, product_id: "00000000-0000-4000-8000-000000000001" }],
    });
    expect(answersAlone).toMatch(/answers require continuation/i);

    const noLocation = await mcp.callExpectError("optimize_basket", {
      items: [{ query: "חלב", pack_qty: 1 }],
    });
    expect(noLocation).toMatch(/city, near, or location/i);
  });

  it(
    "agent journey: list_stores then one-call basket (never search-per-line)",
    async ({ skip }) => {
      requireLive(skip);

      const stores = await mcp.call<{ stores: unknown[] }>("list_stores", {
        city: FIXTURE_CITY,
      });
      expect(stores.stores.length).toBeGreaterThan(0);

      const basket = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: [...FIXTURE_STAPLES_MCP_ITEMS],
        city: FIXTURE_CITY,
        resolution_mode: "fast",
        response_detail: "summary",
      });

      assertCompleteBasket(basket);
      assertPricedPlan(basket.bestSingleStore, "bestSingleStore");
    },
    45_000,
  );

  it(
    "full catalog: Tel Aviv staples avoid known trap products",
    async ({ skip }) => {
      requireFull(skip);

      const result = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: toMcpItems(TEL_AVIV_STAPLES_ITEMS),
        location: TEL_AVIV_LOCATION,
        resolution_mode: "fast",
        response_detail: "summary",
      });

      assertCompleteBasket(result);
      assertPricedPlan(result.bestSingleStore, "bestSingleStore");
      expect(result.items.length).toBe(TEL_AVIV_STAPLES_ITEMS.length);
      assertNoForbiddenSelections(result, FORBIDDEN_FAST_SELECTIONS);
      // Rice-shaped pasta must not win for bare אורז.
      assertNoForbiddenSelections(result, ["פתיתים אורז"]);

      const milk = result.items.find((item) => item.index === 0);
      expect(milk?.resolutionStatus).toBe("resolved");
      // Hebrew has no \b word boundary — require leading חלב + separator, not חלבה.
      expect(milk?.name ?? "").toMatch(/^חלב[\s%0-9]/);
      expect(milk?.name ?? "").not.toMatch(/מרוכז|חלבה|גוף|פנים|משקה/);

      const chicken = result.items.find((item) => item.index === 7);
      expect(chicken?.resolutionStatus).toBe("resolved");
      expect(chicken?.name ?? "").toContain("עוף");
      expect(chicken?.name ?? "").not.toMatch(/כבד|קורקבן|גרון|טחון|שניצל/);
    },
    45_000,
  );

  it(
    "full catalog: neighborhood נווה עמל + strict BBQ confirm→resume",
    async ({ skip }) => {
      requireFull(skip);

      const stores = await mcp.call<{ stores: unknown[] }>("list_stores", {
        location: "נווה עמל, הרצליה",
        radius_km: 10,
      });
      expect(stores.stores.length).toBeGreaterThan(0);

      const first = await mcp.call<BasketOptimizeResult>("optimize_basket", {
        items: toMcpItems(BBQ_ITEMS),
        city: "הרצליה",
        resolution_mode: "strict",
        response_detail: "debug",
        verbose: true,
        stores_limit: 0,
      });

      let complete: Extract<BasketOptimizeResult, { status: "complete" }>;

      if (first.status === "needs_confirmation") {
        expect(first.continuation.length).toBeGreaterThan(20);
        expect(first.questions.length).toBeGreaterThan(0);
        for (const q of first.questions) {
          expect(q.options.length).toBeGreaterThan(0);
          expect(["representative", "brand_family", "pin"]).toContain(q.selectionEffect);
        }

        const resumed = await mcp.call<BasketOptimizeResult>("optimize_basket", {
          continuation: first.continuation,
          answers: pickConfirmationAnswers(first),
        });
        assertCompleteBasket(resumed);
        complete = resumed;
      } else {
        assertCompleteBasket(first);
        complete = first;
      }

      assertPricedPlan(complete.bestSingleStore, "bestSingleStore");
      expect(complete.items.length).toBe(BBQ_ITEMS.length);
      expect((complete.stores ?? []).length).toBeGreaterThan(0);
      assertTargetBranchCoverage(complete, DEFAULT_NEVE_AMAL_STORE_ID);
    },
    90_000,
  );
});
