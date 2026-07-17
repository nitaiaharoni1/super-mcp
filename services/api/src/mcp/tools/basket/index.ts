import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { optimizeBasket } from "../../../services/basket/index.js";
import { resolveRadiusKm, DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, toGeo } from "../shared/location.js";

export function registerBasketTools(server: McpServer): void {
  registerTool(
    server,
    "optimize_basket",
    {
      title: "Find the cheapest basket nearby",
      description:
        "PREFERRED for shopping lists: pass all items in one call (query/gtin/product_id + qty OR amount+unit). " +
        "Resolves products, applies promos, ranks stores by completeness then total. Returns cheapest " +
        `(single-store), multiStore (cheapest-per-item), and top stores (default 5). Requires city and/or near ` +
        `(default ${DEFAULT_RADIUS_KM}km). Check items[].lowConfidence and use resolve_products/search_products ` +
        "only for those lines. Missing items are listed — never silently dropped. Every line carries a " +
        "`link` to open that product on the chain's online store (null if the chain has no online store), " +
        "so the user can click through and add each item.",
      inputSchema: {
        items: z
          .array(
            z.object({
              product_id: z.string().uuid().optional().describe("Canonical product UUID, if known."),
              gtin: z.string().optional().describe("GTIN/barcode, if known."),
              query: z.string().optional().describe("Free-text product name, used if product_id/gtin are unknown."),
              qty: z
                .number()
                .positive()
                .optional()
                .describe("Pack count. Use amount+unit instead for weighed goods (kg/L)."),
              amount: z
                .number()
                .positive()
                .optional()
                .describe("Physical amount, e.g. 1.5 with unit=kg. Converted to packs or weighted qty."),
              unit: z
                .string()
                .optional()
                .describe("Unit for amount: kg, g, L, ml, unit, יח, קג, etc."),
            }),
          )
          .min(1)
          .max(50)
          .describe("Shopping list. Each item needs product_id|gtin|query and qty or amount."),
        ...locationShape,
        include_club: z
          .boolean()
          .optional()
          .describe("Whether to apply club-member-only promotions. Defaults to true."),
        stores_limit: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe("Max store breakdowns to return (default 5). 0 = all compared stores."),
      },
    },
    async ({ items, city, near, radius_km, include_club, stores_limit }) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (!item.product_id && !item.gtin && !item.query) {
          throw new AppError("bad_request", `items[${i}] requires product_id, gtin, or query`, 400);
        }
        if (item.qty == null && item.amount == null) {
          throw new AppError("bad_request", `items[${i}] requires qty or amount`, 400);
        }
        if (item.amount != null && !(item.unit && item.unit.trim())) {
          throw new AppError(
            "bad_request",
            `items[${i}] amount requires unit (kg, g, L, ml, unit, יח, …)`,
            400,
          );
        }
      }
      const geo = toGeo(near);
      return optimizeBasket({
        items: items.map((item) => ({
          productId: item.product_id,
          gtin: item.gtin,
          query: item.query,
          qty: item.qty,
          amount: item.amount,
          unit: item.unit,
        })),
        city,
        near: geo,
        radiusKm: resolveRadiusKm(geo, radius_km),
        includeClub: include_club,
        storesLimit: stores_limit,
      });
    },
  );
}
