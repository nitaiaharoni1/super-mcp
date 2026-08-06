import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchProducts } from "../../../services/search/index.js";
import { registerTool } from "../register.js";
import { locationShape, resolveToolLocation } from "../shared/location.js";

export function registerSearchProductsTool(
  server: McpServer,
  shoppingListTool: "optimize_basket" | "optimize_delivery" = "optimize_basket",
): void {
  registerTool(
    server,
    "search_products",
    {
      title: "Search products",
      description:
        "Search the canonical product catalog by free text (Hebrew or English), brand, category, or exact GTIN. " +
        `Also matches chain listing names. Prefer ${shoppingListTool} with query items for shopping lists — use this ` +
        "only to disambiguate a low_confidence item or when browsing. " +
        `Do not use this for a shopping list or after ${shoppingListTool} has started. ` +
        `Use ${shoppingListTool} directly; strict confirmation options are sufficient to resume. ` +
        "Returns canonical products (not per-chain detail); call get_product for listings.",
      inputSchema: {
        query: z.string().optional().describe("Free text search, Hebrew or English, e.g. 'חלב תנובה' or 'olive oil'."),
        category: z.string().optional().describe("Filter by internal category slug (l1 or l2), e.g. 'dairy'."),
        brand: z.string().optional().describe("Filter by brand name, partial match."),
        gtin: z.string().optional().describe("Exact GTIN/barcode to look up."),
        limit: z.number().int().min(1).max(100).optional().describe("Max results, default 20."),
        ...locationShape,
        store_id: z.string().uuid().optional().describe("Optional store UUID to prefer locally stocked products."),
        in_stock_only: z
          .boolean()
          .optional()
          .describe("When location is set, return only products with a local price. Default false."),
      },
    },
    async ({ query, category, brand, gtin, limit, city, near, location, radius_km, store_id, in_stock_only }) => {
      const loc = await resolveToolLocation({ city, near, location, radius_km });
      const products = await searchProducts({
        q: query ?? "",
        category,
        brand,
        gtin,
        limit: limit ?? 20,
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        storeIds: store_id ? [store_id] : undefined,
        inStockOnly: in_stock_only,
        // Browsing a delivery catalogue: a product no storefront prices cannot
        // be ordered, and offering one costs the shopper a turn to find out.
        // Line resolution deliberately does NOT set this; see SearchProductsParams.
        pricedOnly: true,
      });
      return { products };
    },
  );
}
