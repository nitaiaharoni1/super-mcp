/**
 * Live-catalog resolution probe (diagnostic, not an assertion suite).
 *
 * Exercises ONLY the resolution stack — search -> rank -> fast policy — against
 * the real database, and prints, per basket line, the SKU the resolver settled on
 * plus how many nearby stores actually price it. That pair is the metric that
 * matters for commodity resolution: a name-perfect match carried by one store is
 * a worse answer than a slightly looser match carried by three hundred.
 *
 * Deliberately bypasses store listing / geo / pricing so the numbers reflect
 * resolution quality alone.
 *
 * Opt-in — needs a populated DATABASE_URL:
 *   SUPER_MCP_LIVE_PROBE=1 pnpm --filter @super-mcp/api exec vitest run \
 *     tests/services/basket/resolutionLiveProbe.test.ts
 */
import { describe, expect, it } from "vitest";
import { closePool, query } from "@super-mcp/db";
import { resolveItems } from "../../../src/services/basket/resolve.js";
import { buildItemStatuses } from "../../../src/services/basket/optimize.js";
import { loadCandidateAvailability } from "../../../src/services/basket/loadPricingData.js";
import { collectQuestionOptionProductIds } from "../../../src/services/basket/questionAvailability.js";
import { applyFastResolutionPolicy } from "../../../src/services/basket/resolutionPolicy.js";
import { getActiveOntology } from "../../../src/services/search/index.js";
import { toSearchLocationParams } from "../../../src/services/search/locationScope.js";
import type { BasketItemInput } from "../../../src/services/basket/types.js";

const LIVE = process.env.SUPER_MCP_LIVE_PROBE === "1";

/** Herzliya, Rehov HaBanim — the address used throughout the review. */
const LAT = 32.1624;
const LNG = 34.8443;
const RADIUS_KM = 10;

/** Plain staples: what a shopper types. Every one should resolve to something common. */
const STAPLE_ITEMS: BasketItemInput[] = [
  { query: "חלב 3%", packQty: 2 },
  { query: "לחם אחיד", packQty: 1 },
  { query: "ביצים L", packQty: 1 },
  { query: "קוטג׳", packQty: 2 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "חמאה", packQty: 1 },
  { query: "שמן זית", packQty: 1 },
  { query: "אורז", packQty: 1 },
  { query: "טונה", packQty: 4 },
  { query: "קוקה קולה 1.5 ליטר", packQty: 2 },
  { query: "נייר טואלט", packQty: 1 },
];

/** Qualified asks that must NOT drift toward "whatever is most available". */
const CONTROL_ITEMS: BasketItemInput[] = [
  { query: "חמאה לה גאל", packQty: 1 },
  { query: "קוטג׳ תנובה 5%", packQty: 1 },
  { query: "אורז בסמטי", packQty: 1 },
  { query: "ביצים תבנית 12", packQty: 1 },
  { query: "קוקה קולה זירו", packQty: 1 },
];

const ITEMS = [...STAPLE_ITEMS, ...CONTROL_ITEMS];

async function nearbyStoreIds(): Promise<string[]> {
  const res = await query<{ id: string }>(
    `SELECT id FROM store
      WHERE lat IS NOT NULL AND lng IS NOT NULL
        AND 6371 * 2 * asin(sqrt(
              power(sin(radians(lat - $1) / 2), 2)
              + cos(radians($1)) * cos(radians(lat)) * power(sin(radians(lng - $2) / 2), 2)
            )) <= $3`,
    [LAT, LNG, RADIUS_KM],
  );
  return res.rows.map((r) => r.id);
}

/** Distinct nearby stores carrying a price for each product. */
async function pricedStoreCounts(
  productIds: string[],
  storeIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const res = await query<{ product_id: string; n: string }>(
    `SELECT l.product_id, count(DISTINCT sp.store_id) AS n
       FROM listing l
       JOIN store_price sp ON sp.listing_id = l.id
      WHERE l.product_id = ANY($1::uuid[])
        AND sp.store_id = ANY($2::uuid[])
        AND sp.price > 0
      GROUP BY l.product_id`,
    [productIds, storeIds],
  );
  return new Map(res.rows.map((r) => [r.product_id, Number(r.n)]));
}

describe.skipIf(!LIVE)("live resolution probe", () => {
  it(
    "reports resolved SKU and nearby availability per line",
    async () => {
      const storeIds = await nearbyStoreIds();
      const resolved = await resolveItems(
        ITEMS,
        toSearchLocationParams({
          near: { lat: LAT, lng: LNG },
          radiusKm: RADIUS_KM,
          storeIds,
        }),
      );
      // Availability for EVERY line's candidates, not just the questioned ones.
      // `collectQuestionOptionProductIds` (what optimize.ts passes today) returns
      // candidates of `needs_confirmation` lines only, so resolved lines carry no
      // coverage data and the availability upgrade in resolutionPolicy cannot see
      // that its primary is stocked by one store while a peer is stocked by 73.
      // Set SUPER_MCP_LIVE_PROBE_NARROW=1 to reproduce today's production scope.
      const statuses = buildItemStatuses(resolved);
      const availabilityIds =
        process.env.SUPER_MCP_LIVE_PROBE_NARROW === "1"
          ? collectQuestionOptionProductIds(statuses)
          : [
              ...new Set(
                resolved.flatMap((item) => [
                  ...(item.productId ? [item.productId] : []),
                  ...item.candidates.map((c) => c.productId),
                ]),
              ),
            ];
      const availability = await loadCandidateAvailability(availabilityIds, storeIds);
      const fast = applyFastResolutionPolicy(
        ITEMS,
        resolved,
        availability,
        await getActiveOntology(),
      );

      const ids = new Set<string>();
      for (const item of fast.items) {
        if (item.productId) ids.add(item.productId);
        for (const equivalent of item.equivalents ?? []) ids.add(equivalent.productId);
      }
      const counts = await pricedStoreCounts([...ids], storeIds);

      const lines = [`nearbyStores=${storeIds.length}`];
      lines.push(`${"#".padStart(2)} ${"query".padEnd(20)} ${"nStores".padStart(7)}  name`);
      for (const item of fast.items) {
        const q = ITEMS[item.index]?.query ?? "";
        const n = item.productId ? (counts.get(item.productId) ?? 0) : 0;
        lines.push(
          `${String(item.index).padStart(2)} ${q.slice(0, 20).padEnd(20)} ${String(n).padStart(7)}  ${String(item.name ?? "-").slice(0, 42)} [${item.resolutionStatus ?? "?"}]`,
        );
        for (const equivalent of (item.equivalents ?? []).slice(0, 4)) {
          const en = counts.get(equivalent.productId) ?? 0;
          lines.push(
            `${"".padStart(2)} ${"".padEnd(20)} ${String(en).padStart(7)}    eq: ${equivalent.name.slice(0, 40)}`,
          );
        }
      }
      console.log(lines.join("\n"));

      expect(fast.items).toHaveLength(ITEMS.length);
      await closePool();
    },
    600_000,
  );
});
