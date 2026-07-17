import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { getProductById } from "../../../services/products/index.js";
import { registerTool } from "../register.js";
import { resolveProductId } from "../shared/resolveProduct.js";

export function registerGetProductTool(server: McpServer): void {
  registerTool(
    server,
    "get_product",
    {
      title: "Get product",
      description:
        "Fetch full detail for one canonical product by product_id (UUID) or GTIN barcode, including every " +
        "per-chain listing (chain-specific item code, display name, and package size). Use after search_products " +
        "to confirm identity, or directly when the GTIN is already known.",
      inputSchema: {
        product_id: z.string().uuid().optional().describe("Canonical product UUID."),
        gtin: z.string().optional().describe("GTIN/barcode, used only if product_id is omitted."),
      },
    },
    async ({ product_id, gtin }) => {
      const id = await resolveProductId(product_id, gtin);
      if (!id) throw new AppError("not_found", "Product not found", 404);
      const product = await getProductById(id);
      if (!product) throw new AppError("not_found", "Product not found", 404);
      return { product };
    },
  );
}
