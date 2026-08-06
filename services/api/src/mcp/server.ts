import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  bindAnalyticsContext,
  runWithAnalyticsContext,
  type AnalyticsRequestContext,
} from "../analytics/context.js";
import { captureAuthRejection } from "../analytics/capture.js";
import { deriveClientName } from "../analytics/metadata.js";
import {
  anonymousAnalyticsId,
  authenticate,
  extractApiKey,
  recordUsage,
  type AuthContext,
} from "../auth.js";
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

/**
 * The client's self-reported name, present only on the `initialize` POST. This surface is
 * stateless, so tool calls arrive on later POSTs that carry no handshake and fall back to the
 * user-agent. Analytics only: never used for auth or behaviour.
 */
function mcpClientName(body: unknown): string | undefined {
  if (body == null || typeof body !== "object") return undefined;
  const params = (body as { params?: unknown }).params;
  if (params == null || typeof params !== "object") return undefined;
  const info = (params as { clientInfo?: unknown }).clientInfo;
  if (info == null || typeof info !== "object") return undefined;
  const name = (info as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : undefined;
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
    const startedAt = Date.now();
    const clientName = deriveClientName(request.headers["user-agent"], mcpClientName(request.body));
    // Throws AppError on missing/invalid/rate-limited key; caught by the global error handler.
    // The reply is hijacked below, so onResponse never fires here: a rejection captured anywhere
    // else would be captured nowhere, and a config that 401s would look like silence.
    let auth: AuthContext;
    try {
      auth = await authenticate(request);
    } catch (err) {
      captureAuthRejection({
        surface: "mcp",
        operation: surface.path,
        startedAt,
        error: err,
        analyticsId: anonymousAnalyticsId(request),
        clientName,
        credentialPresented: extractApiKey(request) !== null,
      });
      throw err;
    }
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
      analyticsId: auth.analyticsId,
      clientName,
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
