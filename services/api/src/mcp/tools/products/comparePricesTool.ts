import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { getProductPrices } from "../../../services/products/index.js";
import { DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, resolveToolLocation } from "../shared/location.js";
import { resolveProductId } from "../shared/resolveProduct.js";

export function registerComparePricesTool(server: McpServer): void {
  registerTool(
    server,
    "compare_prices",
    {
      title: "Compare prices across chains and branches",
      description:
        "Compare one product's current price across chains and store branches within a city, near a point, " +
        `or free-text location (default ${DEFAULT_RADIUS_KM}km). Results are sorted cheapest-first. Use ` +
        "sort='unit_price' to rank by ₪ per 100g / 100ml / unit (\"cheaper per 100g\") instead of pack price. " +
        "Every price carries freshness: source_ts and ingested_at — treat source_ts older than ~48h as " +
        "possibly stale. Active promotions are applied to effective_price; list_price is the unpromoted " +
        "shelf price. Each row includes a `link` to open that product on the chain's online store " +
        "(search-by-barcode, or by name for chains that don't index barcodes); null when the chain has no " +
        "online store.",
      inputSchema: {
        product_id: z.string().uuid().optional().describe("Canonical product UUID, from search_products or get_product."),
        gtin: z.string().optional().describe("GTIN/barcode, used only if product_id is omitted."),
        ...locationShape,
        sort: z
          .enum(["price", "unit_price"])
          .optional()
          .describe(
            "price = cheapest pack/effective total (default). unit_price = cheapest per 100g/100ml/unit.",
          ),
        include_club: z
          .boolean()
          .optional()
          .describe("Whether to apply club-member-only promotions to effective_price. Defaults to true."),
      },
    },
    async ({ product_id, gtin, city, near, location, radius_km, sort, include_club }) => {
      const id = await resolveProductId(product_id, gtin);
      if (!id) throw new AppError("not_found", "Product not found", 404);
      const loc = await resolveToolLocation({ city, near, location, radius_km });
      const prices = await getProductPrices(id, {
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        includeClub: include_club,
        sortBy: sort,
      });
      return {
        product_id: id,
        sort: sort ?? "price",
        radius_km: loc.radiusKm,
        prices,
      };
    },
  );
}
