/**
 * Live canary for resumable optimize_basket against a populated local DB.
 *
 * Usage:
 *   BASKET_CONTINUATION_SECRET=... pnpm --filter @super-mcp/api canary:basket
 *
 * Prints phase timings, coverage, quantity decisions, and store names.
 * Does not auto-answer confirmation questions.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "@super-mcp/db";
import { optimizeBasket } from "../services/basket/optimize.js";
import type { BasketItemInput, BasketOptimizeResult } from "../services/basket/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const BBQ_ITEMS: BasketItemInput[] = [
  { query: "פרגיות", amount: 1.75, unit: "kg" },
  { query: "קבבים", amount: 1.5, unit: "kg" },
  { query: "אנטרקוט", amount: 0.75, unit: "kg" },
  { query: "פיתות", amount: 20, unit: "יח" },
  { query: "חומוס", amount: 1.5, unit: "kg" },
  { query: "טחינה", amount: 0.5, unit: "kg" },
  { query: "מלח גס", packQty: 1 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "פלפל", amount: 3, unit: "יח" },
  { query: "בצל", amount: 3, unit: "יח" },
  { query: "חסה", amount: 1, unit: "יח" },
  { query: "לימון", amount: 4, unit: "יח" },
  { query: "אבטיח", amount: 1, unit: "יח" },
  { query: "קוקה קולה 1.5 ליטר", amount: 2, unit: "יח" },
  { query: "יין", amount: 3, unit: "יח" },
  { query: "טייסטרס צ׳ויס", packQty: 1 },
  { query: "שקית קרח", packQty: 1 },
];

function summarize(result: BasketOptimizeResult): Record<string, unknown> {
  if (result.status === "needs_confirmation") {
    return {
      status: result.status,
      questionCount: result.questions.length,
      questions: result.questions.map((q) => ({
        itemIndex: q.itemIndex,
        id: q.id,
        selectionEffect: q.selectionEffect,
        options: q.options.map((o) => ({
          productId: o.productId,
          name: o.name,
          nearbyPricedStores: o.nearbyPricedStores,
          nearbyPricedChains: o.nearbyPricedChains,
          pack: o.pack,
        })),
      })),
      preview: result.preview,
      hint: "Re-run via test harness with continuation + answers; do not reconstruct items.",
    };
  }

  const qtyDecisions = result.items.map((item) => ({
    index: item.index,
    name: item.name,
    qty: item.qty,
    qtyMode: item.qtyMode,
    amount: item.amount,
    unit: item.unit,
    resolutionStatus: item.resolutionStatus,
  }));

  return {
    status: result.status,
    bestSingleStore: result.bestSingleStore
      ? {
          chainName: result.bestSingleStore.chainName,
          storeName: result.bestSingleStore.storeName,
          pricedLines: result.bestSingleStore.pricedLines,
          resolvableLines: result.bestSingleStore.resolvableLines,
          requestedLines: result.bestSingleStore.requestedLines,
          coverageRatio: result.bestSingleStore.coverageRatio,
          total: result.bestSingleStore.total,
          missingItemIndexes: result.bestSingleStore.missingItems.map((m) => m.itemIndex),
        }
      : null,
    cheapestCompleteStore: result.cheapestCompleteStore
      ? {
          chainName: result.cheapestCompleteStore.chainName,
          storeName: result.cheapestCompleteStore.storeName,
          pricedLines: result.cheapestCompleteStore.pricedLines,
          coverageRatio: result.cheapestCompleteStore.coverageRatio,
          total: result.cheapestCompleteStore.total,
        }
      : null,
    multiStore: result.multiStore
      ? {
          pricedLines: result.multiStore.pricedLines,
          coverageRatio: result.multiStore.coverageRatio,
          total: result.multiStore.total,
          storeCount: result.multiStore.storeCount,
          missingItemIndexes: result.multiStore.missingItemIndexes,
          storeNames: [
            ...new Set(
              result.multiStore.lines.map((line) => `${line.chainName} / ${line.storeName}`),
            ),
          ],
        }
      : null,
    qtyDecisions,
    storesCompared: result.storesCompared,
  };
}

async function main(): Promise<void> {
  const secret = process.env.BASKET_CONTINUATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BASKET_CONTINUATION_SECRET must be set (≥32 bytes)");
  }

  const city = process.env.CANARY_BASKET_CITY ?? "הרצליה";
  const started = Date.now();
  const result = await optimizeBasket(
    {
      items: BBQ_ITEMS,
      city,
      verbose: false,
      storesLimit: 3,
    },
    { continuationSecret: secret },
  );
  const elapsedMs = Date.now() - started;

  console.log(
    JSON.stringify(
      {
        event: "canary_basket",
        city,
        elapsedMs,
        ...summarize(result),
      },
      null,
      2,
    ),
  );

  if (elapsedMs > 10_000) {
    console.error(`canary slow: ${elapsedMs}ms (budget 10s for complete / 5s preferred for initial)`);
  }
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
