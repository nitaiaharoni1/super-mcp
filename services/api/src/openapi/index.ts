import { apiKeyHeader, errorSchema } from "./common.js";
import { basketComponentSchemas, basketMcpTools, basketPaths } from "./basket.js";
import { productComponentSchemas, productMcpTools, productPaths } from "./products.js";
import { storeComponentSchemas, storeMcpTools, storePaths } from "./stores.js";
import { systemPaths } from "./system.js";

const mcpToolList = [...productMcpTools, ...basketMcpTools, ...storeMcpTools].join(", ");

export function getOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "super-mcp API",
      version: "0.1.0",
      description:
        "Canonical Israeli supermarket product, price, and promotion data. REST API + remote MCP server " +
        "(mounted at /mcp) share the same service layer. Auth is Bearer by default; query-string API keys " +
        "are only accepted on /mcp when SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1.",
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
      },
    },
    paths: {
      ...systemPaths(mcpToolList),
      ...productPaths,
      ...storePaths,
      ...basketPaths,
    },
  };
}
