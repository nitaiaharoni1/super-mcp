import { errorResponses, withData } from "./common.js";

export function systemPaths(mcpToolList: string): Record<string, unknown> {
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
        summary: "MCP Streamable HTTP endpoint (JSON-RPC 2.0)",
        description:
          `Remote MCP server exposing ${mcpToolList}. Prefer one optimize_basket call for shopping lists. ` +
          "Accepts the same Bearer key, or ?api_key= for clients that can't set headers.",
        responses: { "200": { description: "JSON-RPC response or SSE stream" } },
      },
    },
  };
}
