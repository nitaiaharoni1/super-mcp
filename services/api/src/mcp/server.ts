import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, recordUsage } from "../auth.js";
import { registerTools } from "./tools/index.js";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "super-mcp", version: "0.1.0" },
    {
      instructions:
        "Canonical Israeli supermarket product, price, and promotion data. Every price carries freshness " +
        "(source_ts/ingested_at) — treat prices older than ~48h as possibly stale. " +
        "For shopping lists: call optimize_basket ONCE with items[{query|gtin|product_id, qty|amount+unit}] " +
        "and city (Hebrew/English) or near=lat,lng. Do NOT call search_products per line first. " +
        "Use search_products / resolve_products only when an item is low_confidence or missing. " +
        "Prefer amount+unit for weighed goods (e.g. amount=1.5 unit=kg). Response includes cheapest " +
        "single-store plan plus multiStore (cheapest-per-item across stores). " +
        "Location filters default to 10km when near is set. Use get_promotions to explain discounts.",
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
