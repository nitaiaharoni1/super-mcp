import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, recordUsage } from "../auth.js";
import { registerTools } from "./tools.js";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "super-mcp", version: "0.1.0" },
    {
      instructions:
        "Canonical Israeli supermarket product, price, and promotion data. Every price carries freshness " +
        "(source_ts/ingested_at) — treat prices older than ~48h as possibly stale. Start with search_products or " +
        "get_product to resolve a product_id, then use compare_prices / suggest_substitutes / optimize_basket. " +
        "Location filters (city or near=lat,lng) default to a 10km radius when near is set. optimize_basket " +
        "requires city and/or near. Use get_promotions to explain discounted effective prices.",
    },
  );
  registerTools(server);
  return server;
}

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed. This is a stateless MCP endpoint; use POST." },
  id: null,
};

/**
 * Mounts a remote MCP server (Streamable HTTP, stateless) at /mcp on the same Fastify instance
 * as the REST API, sharing the same API-key auth (Bearer header or ?api_key= query param).
 */
export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    // Throws AppError on missing/invalid/rate-limited key; caught by the global error handler.
    const auth = await authenticate(request);
    const startedAt = Date.now();

    // Streamable HTTP writes directly to the raw response (and may stream SSE), so Fastify
    // must step out of the way. One fresh server+transport per request keeps this stateless
    // and safe for multiple server instances/no sticky sessions.
    reply.hijack();
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.raw.on("close", () => {
      recordUsage(auth.apiKeyId, "/mcp", reply.raw.statusCode || 200, Date.now() - startedAt);
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  });

  // Stateless transport: no session to stream (GET) or terminate (DELETE).
  app.get("/mcp", async (_request, reply) => {
    void reply.code(405).send(METHOD_NOT_ALLOWED);
  });

  app.delete("/mcp", async (_request, reply) => {
    void reply.code(405).send(METHOD_NOT_ALLOWED);
  });
}
