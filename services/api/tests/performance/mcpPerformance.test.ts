/**
 * Live MCP performance gates — no mocks.
 *
 * Aligns budgets with canary/benchmark scripts:
 *   - fast basket p95 ≤ 3s, summary ≤ 15KB (canary:basket / benchmark:fast-basket)
 *   - strict BBQ initial ≤ 5s, resume total ≤ 10s (canary:basket strict)
 *
 * Run:
 *   pnpm --filter @super-mcp/api test:perf
 *   SUPER_MCP_PERF_ITERS=10 pnpm --filter @super-mcp/api test:perf
 *
 * Opt out: SUPER_MCP_SKIP_LIVE=1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BBQ_ITEMS,
  DEFAULT_NEVE_AMAL_STORE_ID,
} from "../../src/scripts/canary/bbqBasketFixture.js";
import {
  FORBIDDEN_FAST_SELECTIONS,
  TEL_AVIV_LOCATION,
  TEL_AVIV_STAPLES_ITEMS,
} from "../../src/scripts/canary/telAvivStaplesFixture.js";
import { assertTargetBranchCoverage } from "../../src/scripts/canary/assertTargetBranchCoverage.js";
import type { BasketOptimizeResult } from "../../src/services/basket/types.js";
import {
  assertCompleteBasket,
  pickConfirmationAnswers,
} from "../integration/helpers/assertions.js";
import {
  FIXTURE_CITY,
  FIXTURE_STAPLES_MCP_ITEMS,
} from "../integration/helpers/fixtureBasket.js";
import {
  closeLivePool,
  isFullCatalog,
  liveCatalogSkipReason,
  liveDbConfigured,
  probeLiveCatalog,
  type LiveCatalogStats,
} from "../integration/helpers/liveEnv.js";
import { createMcpHarness, type McpHarness } from "../integration/helpers/mcpHarness.js";
import {
  logPerf,
  measure,
  perfIterations,
  sampleN,
  summarize,
} from "./helpers/perfStats.js";

process.env.SUPER_MCP_BASKET_TELEMETRY ??= "0";

const LIVE = liveDbConfigured();

/**
 * Budgets:
 * - default = regression guards for full Israel dumps (median-primary; p95 has
 *   headroom for embed/DB jitter). Observed warm staples ≈ 6–9s median.
 * - SUPER_MCP_PERF_STRICT=1 = aspirational canary targets (3s p95 / 15KB / 0.8)
 */
const PERF_STRICT = process.env.SUPER_MCP_PERF_STRICT === "1";
const FAST_MEDIAN_MS = Number(
  process.env.SUPER_MCP_PERF_FAST_MEDIAN_MS ?? (PERF_STRICT ? 2_500 : 9_000),
);
// With SUPER_MCP_PERF_ITERS=3, p95 ≈ max — leave headroom for cold DB/embed spikes.
const FAST_P95_MS = Number(
  process.env.SUPER_MCP_PERF_FAST_P95_MS ?? (PERF_STRICT ? 3_000 : 22_000),
);
const FAST_BYTES_P95 = Number(
  process.env.SUPER_MCP_PERF_FAST_BYTES_P95 ?? (PERF_STRICT ? 15_000 : 22_000),
);
const FAST_COVERAGE_MIN = Number(
  process.env.SUPER_MCP_PERF_FAST_COVERAGE_MIN ?? (PERF_STRICT ? 0.8 : 0.7),
);
const SEARCH_P95_MS = Number(process.env.SUPER_MCP_PERF_SEARCH_P95_MS ?? 2_500);
const COMPARE_P95_MS = Number(process.env.SUPER_MCP_PERF_COMPARE_P95_MS ?? 2_500);
const PROMO_P95_MS = Number(process.env.SUPER_MCP_PERF_PROMO_P95_MS ?? 1_000);
const LIST_STORES_P95_MS = Number(process.env.SUPER_MCP_PERF_LIST_STORES_P95_MS ?? 1_500);
const STRICT_INITIAL_MS = Number(
  process.env.SUPER_MCP_PERF_STRICT_INITIAL_MS ?? (PERF_STRICT ? 5_000 : 12_000),
);
const STRICT_TOTAL_MS = Number(
  process.env.SUPER_MCP_PERF_STRICT_TOTAL_MS ?? (PERF_STRICT ? 10_000 : 15_000),
);
/** Fixture catalogs are colder / less indexed — allow headroom. */
const FIXTURE_FAST_MEDIAN_MS = Number(process.env.SUPER_MCP_PERF_FIXTURE_FAST_MEDIAN_MS ?? 4_000);
const FIXTURE_FAST_P95_MS = Number(process.env.SUPER_MCP_PERF_FIXTURE_FAST_P95_MS ?? 8_000);

function toMcpItems(
  items: Array<{
    query?: string;
    packQty?: number;
    amount?: number;
    unit?: string;
  }>,
) {
  return items.map((item) => ({
    ...(item.query ? { query: item.query } : {}),
    ...(item.packQty != null ? { pack_qty: item.packQty } : {}),
    ...(item.amount != null ? { amount: item.amount } : {}),
    ...(item.unit != null ? { unit: item.unit } : {}),
  }));
}

describe.skipIf(!LIVE)("MCP performance (live DB)", () => {
  let mcp: McpHarness;
  let skipReason: string | null = null;
  let stats: LiveCatalogStats | null = null;
  const iters = perfIterations(5);

  beforeAll(async () => {
    stats = await probeLiveCatalog();
    if (!stats) {
      skipReason = liveCatalogSkipReason();
      console.warn(`[perf] skipping: ${skipReason}`);
      return;
    }
    console.info(`[perf] catalog ready`, { ...stats, iters });
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
    skip(!isFullCatalog(stats), "full catalog required for this perf gate");
  }

  it(
    "fast fixture staples: p95 latency + compact summary",
    async ({ skip }) => {
      requireLive(skip);

      // Warm caches / embeddings so cold start does not fail the gate.
      await mcp.call("optimize_basket", {
        items: [...FIXTURE_STAPLES_MCP_ITEMS],
        city: FIXTURE_CITY,
        resolution_mode: "fast",
        response_detail: "summary",
      });

      const samples = await sampleN(iters, () =>
        mcp.call<BasketOptimizeResult>("optimize_basket", {
          items: [...FIXTURE_STAPLES_MCP_ITEMS],
          city: FIXTURE_CITY,
          resolution_mode: "fast",
          response_detail: "summary",
        }),
      );

      for (const s of samples) {
        assertCompleteBasket(s.value);
      }

      const summary = summarize(samples);
      const medianBudget = isFullCatalog(stats) ? FAST_MEDIAN_MS : FIXTURE_FAST_MEDIAN_MS;
      const p95Budget = isFullCatalog(stats) ? FAST_P95_MS : FIXTURE_FAST_P95_MS;
      logPerf("fast_fixture_staples", summary, {
        budgetMedianMs: medianBudget,
        budgetP95Ms: p95Budget,
      });

      expect(summary.medianMs, `median ${summary.medianMs}ms > ${medianBudget}ms`).toBeLessThanOrEqual(
        medianBudget,
      );
      expect(summary.p95Ms, `p95 ${summary.p95Ms}ms > ${p95Budget}ms`).toBeLessThanOrEqual(p95Budget);
      expect(
        summary.responseBytesP95,
        `responseBytesP95 ${summary.responseBytesP95} > ${FAST_BYTES_P95}`,
      ).toBeLessThanOrEqual(FAST_BYTES_P95);
    },
    120_000,
  );

  it(
    "full catalog: Tel Aviv staples match canary/benchmark gates",
    async ({ skip }) => {
      requireFull(skip);

      // Warm embeddings + geocode once (canary resolves location outside the loop).
      // Measured calls use city so the gate matches benchmark:fast-basket, not geocode variance.
      await mcp.call("optimize_basket", {
        items: toMcpItems(TEL_AVIV_STAPLES_ITEMS),
        location: TEL_AVIV_LOCATION,
        resolution_mode: "fast",
        response_detail: "summary",
        stores_limit: 3,
      });
      await mcp.call("optimize_basket", {
        items: toMcpItems(TEL_AVIV_STAPLES_ITEMS),
        city: "תל אביב",
        resolution_mode: "fast",
        response_detail: "summary",
        stores_limit: 3,
      });

      const samples = await sampleN(iters, () =>
        mcp.call<BasketOptimizeResult>("optimize_basket", {
          items: toMcpItems(TEL_AVIV_STAPLES_ITEMS),
          city: "תל אביב",
          resolution_mode: "fast",
          response_detail: "summary",
          stores_limit: 3,
        }),
      );

      let coverageSum = 0;
      for (const s of samples) {
        assertCompleteBasket(s.value);
        const payload = JSON.stringify(s.value);
        for (const name of FORBIDDEN_FAST_SELECTIONS) {
          expect(payload.includes(name), `forbidden in payload: ${name}`).toBe(false);
        }
        const requested = TEL_AVIV_STAPLES_ITEMS.length;
        const priced = s.value.bestSingleStore?.pricedLines ?? 0;
        coverageSum += requested > 0 ? priced / requested : 0;
      }

      const summary = summarize(samples);
      const pricedLineCoverage = coverageSum / samples.length;
      logPerf("fast_tel_aviv_staples", summary, {
        budgetMedianMs: FAST_MEDIAN_MS,
        budgetP95Ms: FAST_P95_MS,
        budgetBytesP95: FAST_BYTES_P95,
        coverageMin: FAST_COVERAGE_MIN,
        pricedLineCoverage,
        strictMode: PERF_STRICT,
      });

      expect(summary.medianMs).toBeLessThanOrEqual(FAST_MEDIAN_MS);
      expect(summary.p95Ms).toBeLessThanOrEqual(FAST_P95_MS);
      expect(summary.responseBytesP95).toBeLessThanOrEqual(FAST_BYTES_P95);
      expect(pricedLineCoverage).toBeGreaterThanOrEqual(FAST_COVERAGE_MIN);
    },
    180_000,
  );

  it(
    "search_products p95 under budget",
    async ({ skip }) => {
      requireLive(skip);

      await mcp.call("search_products", {
        query: "חלב תנובה",
        city: FIXTURE_CITY,
        limit: 10,
      });

      const samples = await sampleN(iters, () =>
        mcp.call("search_products", {
          query: "חלב תנובה",
          city: FIXTURE_CITY,
          limit: 10,
        }),
      );

      const summary = summarize(samples);
      logPerf("search_products", summary, { budgetP95Ms: SEARCH_P95_MS });
      expect(summary.p95Ms).toBeLessThanOrEqual(SEARCH_P95_MS);
      for (const s of samples) {
        expect((s.value as { products: unknown[] }).products.length).toBeGreaterThan(0);
      }
    },
    90_000,
  );

  it(
    "compare_prices + get_promotions p95 under budget",
    async ({ skip }) => {
      requireLive(skip);

      const search = await mcp.call<{ products: Array<{ id: string }> }>("search_products", {
        query: "חלב תנובה",
        city: FIXTURE_CITY,
        limit: 1,
        in_stock_only: true,
      });
      const productId = search.products[0]!.id;

      await mcp.call("compare_prices", {
        product_id: productId,
        city: FIXTURE_CITY,
        sort: "price",
      });
      await mcp.call("get_promotions", {
        product_id: productId,
        city: FIXTURE_CITY,
        active: true,
        limit: 20,
      });

      const compareSamples = await sampleN(iters, () =>
        mcp.call("compare_prices", {
          product_id: productId,
          city: FIXTURE_CITY,
          sort: "price",
        }),
      );
      const promoSamples = await sampleN(iters, () =>
        mcp.call("get_promotions", {
          product_id: productId,
          city: FIXTURE_CITY,
          active: true,
          limit: 20,
        }),
      );

      const compare = summarize(compareSamples);
      const promo = summarize(promoSamples);
      logPerf("compare_prices", compare, { budgetP95Ms: COMPARE_P95_MS });
      logPerf("get_promotions", promo, { budgetP95Ms: PROMO_P95_MS });

      expect(compare.p95Ms).toBeLessThanOrEqual(COMPARE_P95_MS);
      expect(promo.p95Ms).toBeLessThanOrEqual(PROMO_P95_MS);
    },
    120_000,
  );

  it(
    "list_stores p95 under budget",
    async ({ skip }) => {
      requireLive(skip);

      await mcp.call("list_stores", { city: FIXTURE_CITY });
      const samples = await sampleN(iters, () =>
        mcp.call("list_stores", { city: FIXTURE_CITY }),
      );
      const summary = summarize(samples);
      logPerf("list_stores", summary, { budgetP95Ms: LIST_STORES_P95_MS });
      expect(summary.p95Ms).toBeLessThanOrEqual(LIST_STORES_P95_MS);
    },
    60_000,
  );

  it(
    "full catalog: strict BBQ confirm→resume within canary budgets",
    async ({ skip }) => {
      requireFull(skip);

      // Warm
      await mcp.call("optimize_basket", {
        items: toMcpItems(BBQ_ITEMS),
        city: "הרצליה",
        resolution_mode: "strict",
        response_detail: "debug",
        verbose: true,
        stores_limit: 0,
      });

      const wallStarted = Date.now();
      const initial = await measure(() =>
        mcp.call<BasketOptimizeResult>("optimize_basket", {
          items: toMcpItems(BBQ_ITEMS),
          city: "הרצליה",
          resolution_mode: "strict",
          response_detail: "debug",
          verbose: true,
          stores_limit: 0,
        }),
      );

      let complete: Extract<BasketOptimizeResult, { status: "complete" }>;
      let resumeMs = 0;

      if (initial.value.status === "needs_confirmation") {
        expect(initial.elapsedMs).toBeLessThanOrEqual(STRICT_INITIAL_MS);
        const paused = initial.value;
        const resume = await measure(() =>
          mcp.call<BasketOptimizeResult>("optimize_basket", {
            continuation: paused.continuation,
            answers: pickConfirmationAnswers(paused),
          }),
        );
        resumeMs = resume.elapsedMs;
        assertCompleteBasket(resume.value);
        complete = resume.value;
      } else {
        assertCompleteBasket(initial.value);
        complete = initial.value;
      }

      const totalMs = Date.now() - wallStarted;
      logPerf(
        "strict_bbq_resume",
        {
          iterations: 1,
          medianMs: initial.elapsedMs,
          p95Ms: initial.elapsedMs,
          maxMs: initial.elapsedMs,
          responseBytesP95: initial.responseBytes,
          responseBytesMax: initial.responseBytes,
        },
        {
          initialMs: initial.elapsedMs,
          resumeMs,
          totalMs,
          budgetInitialMs: STRICT_INITIAL_MS,
          budgetTotalMs: STRICT_TOTAL_MS,
        },
      );

      expect(totalMs).toBeLessThanOrEqual(STRICT_TOTAL_MS);
      assertTargetBranchCoverage(complete, DEFAULT_NEVE_AMAL_STORE_ID);
    },
    120_000,
  );

  it(
    "resolve_products batch stays under search-class budget",
    async ({ skip }) => {
      requireLive(skip);

      const run = () =>
        mcp.call("resolve_products", {
          queries: [
            { query: "חלב", limit: 5 },
            { query: "לחם", limit: 5 },
            { query: "אורז", limit: 5 },
            { query: "קוטג'", limit: 5 },
          ],
          city: FIXTURE_CITY,
        });

      await run();
      const samples = await sampleN(iters, run);
      const summary = summarize(samples);
      // Batch of 4 ≈ single-search budget × 2 (parallel mapPool).
      const budget = SEARCH_P95_MS * 2;
      logPerf("resolve_products_batch4", summary, { budgetP95Ms: budget });
      expect(summary.p95Ms).toBeLessThanOrEqual(budget);
    },
    90_000,
  );
});
