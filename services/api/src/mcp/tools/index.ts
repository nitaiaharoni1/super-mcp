import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductTools } from "./products/index.js";
import { registerBasketTools } from "./basket/index.js";
import { registerStoreTools } from "./stores/index.js";

export function registerTools(server: McpServer): void {
  registerBasketTools(server);
  registerProductTools(server);
  registerStoreTools(server);
}
