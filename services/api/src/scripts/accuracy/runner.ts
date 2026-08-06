import { query } from "@super-mcp/db";
import { mapPool } from "@super-mcp/shared";
import { optimizeDelivery } from "../../services/delivery/index.js";
import { BENCHMARK_BASKETS, LABELS_BY_ID, STAPLE_LABELS } from "./labels/staples.js";
import {
  aggregate,
  byCategory,
  scoreBasket,
  type ProductFacts,
  type ScorableBasket,
} from "./scorer.js";
import type { DeliveryOptimizeCompleteResult } from "../../services/delivery/types.js";
import type { BasketScore, BenchmarkReport, StapleLabel } from "./types.js";

/**
 * Runs the labelled baskets through the delivery service directly (not over HTTP), so
 * the benchmark measures the engine rather than the transport, and needs no server.
 *
 * It measures the surface that is actually mounted. It used to drive
 * `optimizeBasket`, which prices shelves at physical branches, and once the ingest
 * narrowed to storefronts a shopper can order from there were no branch prices left
 * for it to find: every basket would have scored zero and the benchmark would have
 * reported a catastrophe instead of a change of scope.
 */

export interface RunOptions {
  /** Restrict to these basket ids. */
  only?: string[];
  /** Baskets to run concurrently. Each takes seconds against a live catalog. */
  concurrency?: number;
}

function labelsFor(ids: string[]): StapleLabel[] {
  const out: StapleLabel[] = [];
  for (const id of ids) {
    const label = LABELS_BY_ID.get(id);
    if (!label) throw new Error(`basket references unknown label id "${id}"`);
    out.push(label);
  }
  return out;
}

/**
 * Class, preparation and stocking count for every resolved product, in two
 * queries rather than per line. `nearbyStores` counts the storefronts that deliver
 * to this address, matching what the recommendation layer will actually consider.
 */
async function loadFacts(
  productIds: string[],
  storeIds: string[],
): Promise<Map<string, ProductFacts>> {
  const facts = new Map<string, ProductFacts>();
  if (productIds.length === 0) return facts;

  const classRes = await query<{
    product_id: string;
    class_l2: string | null;
    preparation: string | null;
  }>(
    `SELECT product_id, class_l2, preparation
       FROM product_class_map WHERE product_id = ANY($1::uuid[])`,
    [productIds],
  );
  for (const row of classRes.rows) {
    facts.set(row.product_id, {
      classL2: row.class_l2,
      preparation: row.preparation,
      nearbyStores: null,
    });
  }

  if (storeIds.length > 0) {
    const availRes = await query<{ product_id: string; stores: string }>(
      `SELECT l.product_id, count(DISTINCT sp.store_id) AS stores
         FROM listing l
         JOIN store_price sp ON sp.listing_id = l.id
        WHERE l.product_id = ANY($1::uuid[])
          AND sp.store_id = ANY($2::uuid[])
          AND sp.price > 0
        GROUP BY l.product_id`,
      [productIds, storeIds],
    );
    for (const row of availRes.rows) {
      const existing = facts.get(row.product_id) ?? {
        classL2: null,
        preparation: null,
        nearbyStores: null,
      };
      existing.nearbyStores = Number(row.stores);
      facts.set(row.product_id, existing);
    }
  }
  return facts;
}

/**
 * The storefronts that quoted this address, the denominator for availability.
 *
 * Taken from the plans the run itself produced rather than queried separately:
 * a storefront that could not serve the address never had a chance to stock the
 * line, and counting it would score the catalogue for a shop the shopper cannot
 * order from.
 */
function servingStoreIds(plans: Array<{ storeId: string | null }>): string[] {
  return [...new Set(plans.map((p) => p.storeId).filter((id): id is string => Boolean(id)))];
}

/**
 * A delivery result in the shape the scorer grades.
 *
 * `bestSingleOrder` is the delivery surface's answer to "the one place that
 * fills this basket", the same question `bestSingleStore` answered on the
 * physical one, so the metrics stay comparable across the change. The summary
 * carries totals only, so the priced lines come from the matching plan.
 *
 * Scored on `deliveredComparableTotal`, which includes the fees. That is a real
 * difference from the old figure, not a translation of it: what an order costs
 * delivered is the number this product exists to get right.
 */
function toScorable(result: DeliveryOptimizeCompleteResult): ScorableBasket {
  const best = result.bestSingleOrder;
  const plan = best ? result.plans.find((p) => p.serviceSlug === best.serviceSlug) : undefined;
  return {
    items: result.items.map((item) => ({
      index: item.index,
      productId: item.productId ?? null,
      name: item.name ?? null,
      resolutionStatus: item.resolutionStatus,
    })),
    bestSingleStore: plan
      ? {
          storeName: plan.brand,
          comparableTotal: plan.deliveredComparableTotal,
          imputedLines: plan.imputedLines,
          lines: plan.lines.map((line) => ({
            itemIndex: line.itemIndex,
            clubOnly: line.clubOnly,
            couponOnly: line.couponOnly,
          })),
        }
      : null,
  };
}

async function runOneBasket(
  basket: (typeof BENCHMARK_BASKETS)[number],
): Promise<BasketScore> {
  const labels = labelsFor(basket.labelIds);
  const started = Date.now();
  try {
    const result = await optimizeDelivery(
      {
        items: labels.map((l) => ({
          query: l.query,
          packQty: l.packQty,
          amount: l.amount,
          unit: l.unit,
        })),
        address: basket.location,
        // standard keeps every priced line; summary caps and prunes them.
        responseDetail: "standard",
        resolutionMode: "fast",
      },
      { continuationSecret: process.env.BASKET_CONTINUATION_SECRET ?? "" },
    );
    const elapsedMs = Date.now() - started;

    if (result.status !== "complete") {
      return {
        basketId: basket.id,
        name: basket.name,
        requestedLines: labels.length,
        acceptedLines: 0,
        pricedLines: 0,
        clubOnlyLines: 0,
        couponOnlyLines: 0,
        imputedLines: 0,
        comparableTotal: null,
        storeName: null,
        elapsedMs,
        lines: [],
        error: `unexpected status ${result.status}`,
      };
    }

    const items = (result.items ?? []) as Array<{
      index: number;
      productId: string | null;
      name: string | null;
      resolutionStatus: string;
    }>;
    const productIds = [
      ...new Set(items.map((i) => i.productId).filter((id): id is string => Boolean(id))),
    ];
    const storeIds = servingStoreIds(result.plans);
    const facts = await loadFacts(productIds, storeIds);

    return scoreBasket({
      basketId: basket.id,
      name: basket.name,
      labels,
      response: toScorable(result),
      facts: (id) => facts.get(id),
      elapsedMs,
      nearbyStoreTotal: storeIds.length,
    });
  } catch (err) {
    return {
      basketId: basket.id,
      name: basket.name,
      requestedLines: labels.length,
      acceptedLines: 0,
      pricedLines: 0,
      clubOnlyLines: 0,
      couponOnlyLines: 0,
      imputedLines: 0,
      comparableTotal: null,
      storeName: null,
      elapsedMs: Date.now() - started,
      lines: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBenchmark(opts: RunOptions = {}): Promise<BenchmarkReport> {
  const selected = opts.only?.length
    ? BENCHMARK_BASKETS.filter((b) => opts.only!.includes(b.id))
    : BENCHMARK_BASKETS;
  if (selected.length === 0) throw new Error("no baskets selected");

  const baskets = await mapPool(selected, opts.concurrency ?? 2, (basket) =>
    runOneBasket(basket),
  );

  return {
    // Stamped by the caller's clock; the scorer itself stays pure.
    generatedAt: new Date().toISOString(),
    labelCount: STAPLE_LABELS.length,
    basketCount: selected.length,
    metrics: aggregate(baskets),
    byCategory: byCategory(baskets),
    baskets,
  };
}
