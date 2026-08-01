import { errorResponses, withData } from "./common.js";

export const readinessReportSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ready", "degraded"] },
    checkedAt: { type: "string", format: "date-time" },
    storeCoordinates: {
      type: "object",
      properties: {
        total: { type: "integer" },
        valid: { type: "integer" },
        coverage: { type: "number", description: "valid / total (0 when total is 0)." },
      },
    },
    localPrices: {
      type: "object",
      properties: {
        currentRows: { type: "integer" },
        storesWithCurrentPrices: { type: "integer" },
        newestSourceTs: { type: "string", format: "date-time", nullable: true },
        freshnessHours: { type: "integer" },
      },
    },
  },
};

export function systemPaths(
  storesMcpToolList: string,
  onlineMcpToolList: string,
): Record<string, unknown> {
  return {
    "/health": {
      get: {
        summary: "Health check",
        security: [],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" }, time: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        summary: "Readiness check",
        description:
          "Dependency-aware readiness probe (store coordinate coverage and current local prices). " +
          "Distinct from /health, which remains a dependency-free liveness check.",
        security: [],
        responses: {
          "200": {
            description: "Ready — stores and current prices are available",
            content: { "application/json": { schema: readinessReportSchema } },
          },
          "503": {
            description: "Degraded — missing stores or current price rows",
            content: { "application/json": { schema: readinessReportSchema } },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "OpenAPI document",
        security: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/v1/usage": {
      get: {
        summary: "Usage summary for the caller's API key",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: withData({
                  type: "object",
                  properties: {
                    apiKey: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        rateLimitPerMinute: { type: "integer" },
                      },
                    },
                    totalRequests: { type: "integer" },
                    requestsLast24h: { type: "integer" },
                    requestsLastMinute: { type: "integer" },
                    byRoute: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          route: { type: "string" },
                          count: { type: "integer" },
                          avgLatencyMs: { type: "number", nullable: true },
                          lastUsed: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                }),
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/mcp": {
      post: {
        summary: "MCP Streamable HTTP endpoint — physical stores (JSON-RPC 2.0)",
        description:
          `Remote MCP server for shops a shopper drives to, exposing ${storesMcpToolList}. ` +
          "For shopping lists: call optimize_basket with items and location; if status is " +
          "needs_confirmation, resume once with continuation and answers. " +
          "Use pack_qty for shelf packs and amount+unit for physical need. " +
          "For groceries delivered to an address, use /mcp/online instead. " +
          "Auth is Bearer by default; query-string ?api_key= is accepted only on the MCP paths when " +
          "SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1 (legacy escape hatch).",
        responses: { "200": { description: "JSON-RPC response or SSE stream" } },
      },
    },
    "/mcp/online": {
      post: {
        summary: "MCP Streamable HTTP endpoint — online delivery (JSON-RPC 2.0)",
        description:
          `Remote MCP server for groceries delivered to an address, exposing ${onlineMcpToolList}. ` +
          "Ranks storefronts on what the ORDER costs (items + delivery fee + service fee), not what the " +
          "goods cost, because a ₪35.90 delivery fee outweighs most price differences between chains. " +
          "Online prices are not shelf prices: each storefront's own regulated feed rows are used. " +
          "Delivery fees carry a confidence and a verifiedAt — a fee marked unknown must not be quoted. " +
          "Served by the same process as /mcp by default; set SUPER_MCP_SURFACES to split them across " +
          "deployments.",
        responses: { "200": { description: "JSON-RPC response or SSE stream" } },
      },
    },
  };
}
