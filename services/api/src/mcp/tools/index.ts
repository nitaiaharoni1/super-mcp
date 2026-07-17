import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductTools } from "./products/index.js";
import { registerBasketTools } from "./basket/index.js";
import { registerStoreTools } from "./stores/index.js";

export function registerTools(server: McpServer): void {
  registerProductTools(server);
  registerBasketTools(server);
  registerStoreTools(server);
}
