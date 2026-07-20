import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { suggestSubstitutes } from "../../../services/substitutes/index.js";
import { registerTool } from "../register.js";
import { locationShape, resolveToolLocation } from "../shared/location.js";
import { resolveProductId } from "../shared/resolveProduct.js";

export function registerSuggestSubstitutesTool(server: McpServer): void {
  registerTool(
    server,
    "suggest_substitutes",
    {
      title: "Suggest cheaper similar products",
      description:
        "Given a product, suggest similar alternatives (same category and/or similar name) that are cheaper " +
        "per 100g / 100ml / unit in nearby stores (default 10km when a point is set via near or location). " +
        "Use when the user asks for a cheaper brand, private-label alternative, or \"cheaper per 100g\". " +
        "Returns baseline unit price plus ranked substitutes with savings.",
      inputSchema: {
        product_id: z.string().uuid().optional().describe("Canonical product UUID."),
        gtin: z.string().optional().describe("GTIN/barcode, used only if product_id is omitted."),
        ...locationShape,
        limit: z.number().int().min(1).max(50).optional().describe("Max substitutes, default 10."),
        cheaper_only: z
          .boolean()
          .optional()
          .describe("If true (default), only return substitutes with lower unit price than the baseline."),
      },
    },
    async ({ product_id, gtin, city, near, location, radius_km, limit, cheaper_only }) => {
      const id = await resolveProductId(product_id, gtin);
      if (!id) throw new AppError("not_found", "Product not found", 404);
      const loc = await resolveToolLocation({ city, near, location, radius_km });
      return suggestSubstitutes(id, {
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        limit,
        cheaperOnly: cheaper_only,
      });
    },
  );
}
