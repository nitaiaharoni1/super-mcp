import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, recordUsage } from "../auth.js";
import { beginPrivilegedAudit, finalizePrivilegedAudit } from "../services/privilegedAudit.js";
import { registerTools } from "./tools/index.js";

export const MCP_SERVER_INSTRUCTIONS =
  "Canonical Israeli supermarket product, price, and promotion data. Every price carries freshness " +
  "(source_ts/ingested_at) — treat prices older than ~48h as possibly stale. " +
  "For shopping lists: call optimize_basket with items[{query|gtin|product_id, pack_qty|amount+unit}] " +
  "and city (Hebrew/English) or near=lat,lng. If status is needs_confirmation, answer every required " +
  "question and call again with only {continuation, answers}. If status is complete, use " +
  "bestSingleStore / cheapestCompleteStore / multiStore. Do not call search_products per line first; " +
  "use search_products / resolve_products only for unresolved or missing lines. Use amount+unit for " +
  "natural counts and weighed goods (20 pitas: amount=20, unit=יח; 1.5kg: amount=1.5, unit=kg). " +
  "Location filters default to 10km when near is set. Use get_promotions to explain discounts.";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "super-mcp", version: "0.1.0" },
    {
      instructions: MCP_SERVER_INSTRUCTIONS,
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
 * as the REST API, sharing Bearer API-key auth. Query-string ?api_key= is accepted only when
 * SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1 (legacy MCP escape hatch).
 */
export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    // Throws AppError on missing/invalid/rate-limited key; caught by the global error handler.
    const auth = await authenticate(request);
    const startedAt = Date.now();
    const auditId =
      auth.role === "master"
        ? await beginPrivilegedAudit({ apiKeyId: auth.apiKeyId, method: request.method, route: "/mcp" })
        : null;
    let auditErrorCode: string | null = null;
    let auditFinalized = false;

    // Streamable HTTP writes directly to the raw response (and may stream SSE), so Fastify
    // must step out of the way. One fresh server+transport per request keeps this stateless
    // and safe for multiple server instances/no sticky sessions.
    reply.hijack();
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    const finalizeAudit = async (statusCode: number, errorCode: string | null): Promise<void> => {
      if (!auditId || auditFinalized) return;
      auditFinalized = true;
      await finalizePrivilegedAudit(auditId, statusCode, Date.now() - startedAt, errorCode);
    };

    reply.raw.on("close", () => {
      const statusCode = reply.raw.statusCode || 200;
      const latency = Date.now() - startedAt;
      void finalizeAudit(statusCode, auditErrorCode).catch((err: unknown) => {
        request.log.error({ err }, "failed to finalize MCP privileged audit");
      });
      recordUsage(auth.apiKeyId, "/mcp", statusCode, latency);
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      auditErrorCode = "internal_error";
      request.log.error({ err }, "mcp request failed");
      try {
        await finalizeAudit(500, auditErrorCode);
      } catch (auditErr) {
        request.log.error({ err: auditErr }, "failed to finalize MCP privileged audit");
      }
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
