import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mapPool } from "@super-mcp/shared";
import { searchProductsScored } from "../../../services/search/index.js";
import { resolveRadiusKm } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, toGeo } from "../shared/location.js";

export function registerResolveProductsTool(server: McpServer): void {
  registerTool(
    server,
    "resolve_products",
    {
      title: "Batch-resolve product queries",
      description:
        "Resolve many free-text product queries (or GTINs) in one call. Returns top candidates with scores " +
        "for each query. Prefer optimize_basket for shopping lists; use this when you need to disambiguate " +
        "several ambiguous items before comparing prices.",
      inputSchema: {
        queries: z
          .array(
            z.object({
              query: z.string().optional().describe("Free-text product name."),
              gtin: z.string().optional().describe("Exact GTIN/barcode."),
              limit: z.number().int().min(1).max(20).optional().describe("Max candidates per query, default 5."),
            }),
          )
          .min(1)
          .max(50),
        ...locationShape,
        store_id: z.string().uuid().optional().describe("Optional store UUID to prefer locally stocked products."),
      },
    },
    async ({ queries, city, near, radius_km, store_id }) => {
      const geo = toGeo(near);
      const results = await mapPool(queries, 6, async (q, index) => {
        if (!q.query && !q.gtin) {
          return { index, query: q.query ?? null, gtin: q.gtin ?? null, candidates: [] };
        }
        const candidates = await searchProductsScored({
          q: q.query ?? "",
          gtin: q.gtin,
          limit: q.limit ?? 5,
          city,
          near: geo,
          radiusKm: resolveRadiusKm(geo, radius_km),
          storeIds: store_id ? [store_id] : undefined,
        });
        return { index, query: q.query ?? null, gtin: q.gtin ?? null, candidates };
      });
      return { results };
    },
  );
}
