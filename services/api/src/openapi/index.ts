import { apiKeyHeader, errorSchema } from "./common.js";
import { basketComponentSchemas } from "./basket.js";
import { deliveryComponentSchemas, deliveryMcpTools, deliveryPaths } from "./delivery.js";
import { productComponentSchemas, productPaths } from "./products.js";
import { storeComponentSchemas, storePaths } from "./stores.js";
import { systemPaths } from "./system.js";

const onlineMcpToolList = [
  ...deliveryMcpTools,
  "search_products",
  "get_product",
  "get_promotions",
].join(", ");
export function getOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "super-mcp API",
      version: "0.1.0",
      description:
        "Canonical Israeli supermarket product, price, and promotion data.\n\n" +
        "MCP: /mcp is SuperMCP for online supermarket delivery (optimize_delivery). " +
        "/mcp/online is a compatibility alias for the same server. " +
        "Online prices are NOT shelf prices — each storefront's own regulated feed rows are used. " +
        "Auth is Bearer by default; query-string API keys are only accepted on the MCP paths when " +
        "SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1.",
    },
    servers: [{ url: "/" }],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: apiKeyHeader,
      schemas: {
        Error: errorSchema,
        ...productComponentSchemas,
        ...storeComponentSchemas,
        // Shared line schema is $ref'd by delivery.
        ...basketComponentSchemas,
        ...deliveryComponentSchemas,
      },
    },
    paths: {
      ...systemPaths(onlineMcpToolList),
      ...productPaths,
      ...storePaths,
      ...deliveryPaths,
    },
  };
}
