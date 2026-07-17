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
