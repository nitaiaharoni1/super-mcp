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
import { resolveBuildRevision } from "./protocolIdentity.js";
import { buildOnlineInstructions, enabledSurfaces, type McpSurface } from "./surfaces.js";

/** Instructions for the live SuperMCP online-delivery surface. */
export function buildMcpServerInstructions(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return buildOnlineInstructions(env);
}

/** Snapshot at module load for tests; recreate via buildMcpServerInstructions in createMcpServer. */
export const MCP_SERVER_INSTRUCTIONS = buildMcpServerInstructions();

function createMcpServer(
  surface: McpSurface,
  analyticsCtx: AnalyticsRequestContext,
): McpServer {
  const server = new McpServer(
    { name: surface.serverName, version: resolveBuildRevision() },
    { instructions: surface.buildInstructions(process.env) },
  );
  // Bind before registerTools so every tool closure can resolve auth for capture.
  bindAnalyticsContext(server, analyticsCtx);
  surface.registerTools(server);
  return server;
}

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed. This is a stateless MCP endpoint; use POST." },
  id: null,
};

/**
 * Mounts every enabled MCP surface (Streamable HTTP, stateless) on the same Fastify
 * instance as the REST API, sharing Bearer API-key auth. Query-string ?api_key= is
 * accepted only when SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1 (legacy MCP escape hatch).
 *
 * Mounts the online supermarket surface at `/mcp` (canonical) and `/mcp/online`
 * (compat alias). Physical stores are not served. See `enabledSurfaces`.
 */
export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  for (const surface of enabledSurfaces()) {
    registerSurfaceRoutes(app, surface);
  }
}

function registerSurfaceRoutes(app: FastifyInstance, surface: McpSurface): void {
  app.post(surface.path, async (request, reply) => {
    // Throws AppError on missing/invalid/rate-limited key; caught by the global error handler.
    const auth = await authenticate(request);
    const startedAt = Date.now();
    const auditId =
      auth.role === "master"
        ? await beginPrivilegedAudit({
            apiKeyId: auth.apiKeyId,
            method: request.method,
            route: surface.path,
          })
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
    const server = createMcpServer(surface, analyticsCtx);
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
      recordUsage(auth.apiKeyId, surface.path, statusCode, latency);
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
  app.get(surface.path, async (_request, reply) => {
    void reply.code(405).send(METHOD_NOT_ALLOWED);
  });

  app.delete(surface.path, async (_request, reply) => {
    void reply.code(405).send(METHOD_NOT_ALLOWED);
  });
}
