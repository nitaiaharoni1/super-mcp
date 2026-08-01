import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComparePricesTool } from "./comparePricesTool.js";
import { registerGetProductTool } from "./getProductTool.js";
import { registerResolveProductsTool } from "./resolveProductsTool.js";
import { registerSearchProductsTool } from "./searchProductsTool.js";
import { registerSuggestSubstitutesTool } from "./suggestSubstitutesTool.js";

export function registerProductTools(server: McpServer): void {
  registerSearchProductsTool(server);
  registerGetProductTool(server);
  registerComparePricesTool(server);
  registerSuggestSubstitutesTool(server);
  registerResolveProductsTool(server);
}

/**
 * The product tools the delivery surface carries.
 *
 * `search_products` and `get_product` are catalogue questions — the same product
 * identity, the same Hebrew matching, the same GTIN — so they are registered
 * unchanged rather than duplicated.
 *
 * `compare_prices` and `suggest_substitutes` are deliberately absent. Both answer
 * "where is this cheapest nearby", which is a question about branches within a
 * radius; on a surface where the answer to every location question is a delivery
 * area rather than a distance, they would return shelf prices the shopper cannot
 * get without driving. `optimize_delivery` covers the online equivalent, with the
 * fees included.
 */
export function registerOnlineProductTools(server: McpServer): void {
  registerSearchProductsTool(server);
  registerGetProductTool(server);
}
