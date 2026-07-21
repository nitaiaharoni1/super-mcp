import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  bindAnalyticsContext,
  runWithAnalyticsContext,
  type AnalyticsRequestContext,
} from "../analytics/context.js";
import { authenticate, recordUsage } from "../auth.js";
import { beginPrivilegedAudit, finalizePrivilegedAudit } from "../services/privilegedAudit.js";
import { protocolIdentityLine, resolveBuildRevision } from "./protocolIdentity.js";
import { registerTools } from "./tools/index.js";

export function buildMcpServerInstructions(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    "Shopping list → call optimize_basket exactly once with all items and location. " +
    "Accept the default fast best-effort choices unless the user explicitly requests " +
    "exact products; then set resolution_mode=strict. " +
    "Never search or compare each basket line separately. " +
    "Canonical Israeli supermarket product, price, and promotion data. Every price carries freshness " +
    "(source_ts/ingested_at) — treat prices older than ~48h as possibly stale. " +
    "Call optimize_basket with items[{query|gtin|product_id, pack_qty|amount+unit}] " +
    "and city (Hebrew/English), near=lat,lng, or location (free-text neighborhood/address, e.g. " +
    "'נווה עמל, הרצליה'). Prefer location for neighborhoods; near remains coordinates. Do not combine " +
    "near with location. If status is needs_confirmation, answer every required question and call again " +
    "with only {continuation, answers}. If status is complete, use bestSingleStore / cheapestCompleteStore " +
    "/ multiStore. Plan totals sum priced lines only — check totalScope; priced_lines_only is not the " +
    "full basket total. Use search_products / resolve_products only for unresolved or missing lines. " +
    "Use amount+unit for natural counts and weighed goods " +
    "(20 pitas: amount=20, unit=יח; 1.5kg: amount=1.5, unit=kg). Location filters default to 10km when a " +
    "point is resolved. Use get_promotions to explain discounts. " +
    protocolIdentityLine(env)
  );
}

/** Snapshot at module load for tests; recreate via buildMcpServerInstructions in createMcpServer. */
export const MCP_SERVER_INSTRUCTIONS = buildMcpServerInstructions();

function createMcpServer(analyticsCtx: AnalyticsRequestContext): McpServer {
  const instructions = buildMcpServerInstructions();
  const server = new McpServer(
    { name: "super-mcp", version: resolveBuildRevision() },
    {
      instructions,
    },
  );
  // Bind before registerTools so every tool closure can resolve auth for capture.
  bindAnalyticsContext(server, analyticsCtx);
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
    const analyticsCtx: AnalyticsRequestContext = {
      apiKeyId: auth.apiKeyId,
      role: auth.role,
    };
    const server = createMcpServer(analyticsCtx);
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
      // ALS backup + WeakMap primary (bound in createMcpServer).
      await runWithAnalyticsContext(analyticsCtx, async () => {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      });
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
