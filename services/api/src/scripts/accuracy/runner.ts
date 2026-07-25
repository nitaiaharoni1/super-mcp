import { query } from "@super-mcp/db";
import { mapPool } from "@super-mcp/shared";
import { optimizeBasket } from "../../services/basket/index.js";
import { resolveLocationInput } from "../../lib/locationInput.js";
import { BENCHMARK_BASKETS, LABELS_BY_ID, STAPLE_LABELS } from "./labels/staples.js";
import { aggregate, byCategory, scoreBasket, type ProductFacts } from "./scorer.js";
import type { BasketScore, BenchmarkReport, StapleLabel } from "./types.js";

/**
 * Runs the labelled baskets through the basket service directly (not over HTTP), so
 * the benchmark measures the engine rather than the transport, and needs no server.
 */

export interface RunOptions {
  /** Restrict to these basket ids. */
  only?: string[];
  /** Baskets to run concurrently. Each takes seconds against a live catalog. */
  concurrency?: number;
  /** Radius passed to every basket. */
  radiusKm?: number;
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
 * Class, preparation and nearby-store count for every resolved product, in two
 * queries rather than per line. `nearbyStores` counts BRANCHES only, matching what
 * the recommendation layer will actually consider.
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

/** Branch store ids inside `radiusKm` of a point, the denominator for availability. */
async function nearbyBranchIds(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<string[]> {
  const res = await query<{ id: string }>(
    `SELECT id FROM store
      WHERE (store_kind IS NULL OR store_kind = 'branch')
        AND lat IS NOT NULL AND lng IS NOT NULL
        AND 6371 * 2 * asin(sqrt(
              power(sin(radians(lat - $1) / 2), 2)
              + cos(radians($1)) * cos(radians(lat)) * power(sin(radians(lng - $2) / 2), 2)
            )) <= $3`,
    [lat, lng, radiusKm],
  );
  return res.rows.map((r) => r.id);
}

async function runOneBasket(
  basket: (typeof BENCHMARK_BASKETS)[number],
  radiusKm: number,
): Promise<BasketScore> {
  const labels = labelsFor(basket.labelIds);
  const started = Date.now();
  try {
    const loc = await resolveLocationInput(
      { location: basket.location, radiusKm },
      { geocodeStrategy: "fast" },
    );
    const result = await optimizeBasket(
      {
        items: labels.map((l) => ({
          query: l.query,
          packQty: l.packQty,
          amount: l.amount,
          unit: l.unit,
        })),
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        locationOrigin: loc.locationOrigin,
        geocodeMs: loc.geocodeMs,
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
    const storeIds = loc.near
      ? await nearbyBranchIds(loc.near.lat, loc.near.lng, radiusKm)
      : [];
    const facts = await loadFacts(productIds, storeIds);

    return scoreBasket({
      basketId: basket.id,
      name: basket.name,
      labels,
      response: result as never,
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
  const radiusKm = opts.radiusKm ?? 10;
  const selected = opts.only?.length
    ? BENCHMARK_BASKETS.filter((b) => opts.only!.includes(b.id))
    : BENCHMARK_BASKETS;
  if (selected.length === 0) throw new Error("no baskets selected");

  const baskets = await mapPool(selected, opts.concurrency ?? 2, (basket) =>
    runOneBasket(basket, radiusKm),
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
