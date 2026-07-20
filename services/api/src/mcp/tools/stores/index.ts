import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyLocationOriginHonesty,
} from "../../../lib/locationInput.js";
import { resolveStoreLocation } from "../../../lib/resolveStoreLocation.js";
import { listPromotions } from "../../../services/promotions/index.js";
import { DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, resolveToolLocation } from "../shared/location.js";

export function registerStoreTools(server: McpServer): void {
  registerTool(
    server,
    "list_stores",
    {
      title: "List store branches",
      description:
        "List physical store branches, optionally filtered by chain id, city, near=lat,lng, or " +
        `location (free-text neighborhood/address) + radius_km (default ${DEFAULT_RADIUS_KM}km). ` +
        "Use to discover which branches exist in an area before scoping compare_prices/optimize_basket.",
      inputSchema: {
        chain: z.string().optional().describe("Chain id (the chain's legal barcode id) to filter by."),
        ...locationShape,
      },
    },
    async ({ chain, city, near, location, radius_km }) => {
      const loc = await resolveToolLocation({ city, near, location, radius_km });
      const result = await resolveStoreLocation({
        chain,
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
      });
      return {
        stores: result.stores,
        location: applyLocationOriginHonesty(result.location, loc.locationOrigin),
      };
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
        city: z
          .string()
          .optional()
          .describe(
            "City name in Hebrew or English (also accepts CBS locality codes). Restricts to promotions at " +
              "stores in that city plus chain-wide promotions of chains present there.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max promotions to return, ordered by soonest end date. Defaults to 50, max 200."),
      },
    },
    async ({ store_id, product_id, active, city, limit }) => {
      const promotions = await listPromotions({
        storeId: store_id,
        productId: product_id,
        activeOnly: active ?? true,
        city,
        limit,
      });
      return { promotions };
    },
  );
}
