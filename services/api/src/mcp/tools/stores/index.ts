import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveStoreLocation } from "../../../lib/resolveStoreLocation.js";
import { listPromotions } from "../../../services/promotions/index.js";
import { resolveRadiusKm } from "../../../lib/defaults.js";
import { DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, toGeo } from "../shared/location.js";

export function registerStoreTools(server: McpServer): void {
  registerTool(
    server,
    "list_stores",
    {
      title: "List store branches",
      description:
        "List physical store branches, optionally filtered by chain id, city, or near a point + radius_km " +
        `(default ${DEFAULT_RADIUS_KM}km). Use to discover which branches exist in an area before scoping ` +
        "compare_prices/optimize_basket.",
      inputSchema: {
        chain: z.string().optional().describe("Chain id (the chain's legal barcode id) to filter by."),
        ...locationShape,
      },
    },
    async ({ chain, city, near, radius_km }) => {
      const geo = toGeo(near);
      const result = await resolveStoreLocation({
        chain,
        city,
        near: geo,
        radiusKm: resolveRadiusKm(geo, radius_km),
      });
      return result;
    },
  );

  registerTool(
    server,
    "get_promotions",
    {
      title: "Get promotions",
      description:
        "List promotions (e.g. '2 for 30₪', club-member price, second-unit discount), optionally filtered by " +
        "store_id or product_id, and by active=true to only return promotions currently running. Use this to " +
        "explain why a compare_prices or optimize_basket effective_price is lower than list_price.",
      inputSchema: {
        store_id: z.string().uuid().optional().describe("Filter to promotions at this store."),
        product_id: z.string().uuid().optional().describe("Filter to promotions covering this canonical product."),
        active: z.boolean().optional().describe("If true, only currently-active promotions. Defaults to true."),
      },
    },
    async ({ store_id, product_id, active }) => {
      const promotions = await listPromotions({
        storeId: store_id,
        productId: product_id,
        activeOnly: active ?? true,
      });
      return { promotions };
    },
  );
}
