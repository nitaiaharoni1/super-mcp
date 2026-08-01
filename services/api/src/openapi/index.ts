import { apiKeyHeader, errorSchema } from "./common.js";
import { basketComponentSchemas, basketMcpTools, basketPaths } from "./basket.js";
import { deliveryComponentSchemas, deliveryMcpTools, deliveryPaths } from "./delivery.js";
import { productComponentSchemas, productMcpTools, productPaths } from "./products.js";
import { storeComponentSchemas, storeMcpTools, storePaths } from "./stores.js";
import { systemPaths } from "./system.js";

// Per surface, not one combined list: /mcp never registers a delivery tool, and
// a spec claiming otherwise sends integrators looking for a tool that is not there.
const storesMcpToolList = [...productMcpTools, ...basketMcpTools, ...storeMcpTools].join(", ");
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
        "TWO MCP SURFACES, one service layer:\n" +
        "  /mcp        physical branches — shelf prices, distance, which shop to drive to (optimize_basket)\n" +
        "  /mcp/online online storefronts — items + delivery fee + minimum order (optimize_delivery)\n\n" +
        "They share catalogue identity, Hebrew search, promotion maths and unit normalisation, and differ " +
        "in what they optimise: travel versus a published delivery fee. Online prices are NOT shelf prices " +
        "— each storefront's own regulated feed rows are used. " +
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
        ...basketComponentSchemas,
        ...deliveryComponentSchemas,
      },
    },
    paths: {
      ...systemPaths(storesMcpToolList, onlineMcpToolList),
      ...productPaths,
      ...storePaths,
      ...basketPaths,
      ...deliveryPaths,
    },
  };
}
