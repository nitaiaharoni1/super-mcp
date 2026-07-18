import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { authenticate, authorize, recordUsage, type Capability } from "./auth.js";
import { sendError, toAppError } from "./lib/errors.js";
import { getOpenApiSpec } from "./openapi.js";
import { beginPrivilegedAudit, finalizePrivilegedAudit } from "./services/privilegedAudit.js";
import {
  registerAdminRoutes,
  registerBasketRoutes,
  registerProductRoutes,
  registerPromotionRoutes,
  registerReadinessRoute,
  registerStoreRoutes,
} from "./routes/index.js";
import { registerMcpRoutes } from "./mcp/server.js";

const PUBLIC_PATHS = new Set(["/health", "/ready", "/openapi.json"]);

function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PUBLIC_PATHS.has(path);
}

function capabilityForUrl(url: string): Capability {
  const path = url.split("?")[0] ?? url;
  if (path.startsWith("/v1/admin/keys")) return "key_admin";
  if (path === "/v1/admin/usage") return "global_usage";
  if (path.startsWith("/v1/admin/")) return "key_admin";
  return "shopping";
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Strip query strings from logged URLs (legacy ?api_key= on /mcp when enabled) and
      // redact Authorization so a raw Bearer key never reaches the logs.
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: (request.url.split("?")[0] ?? request.url),
          };
        },
      },
      redact: {
        paths: ["req.headers.authorization", 'req.headers["authorization"]'],
        remove: true,
      },
    },
  });

  app.decorateRequest("auth", null);
  app.decorateRequest("startTime", 0);
  app.decorateRequest("privilegedAuditId", null);
  app.decorateRequest("privilegedAuditErrorCode", null);

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  await registerReadinessRoute(app);
  app.get("/openapi.json", async () => getOpenApiSpec());

  app.addHook("onRequest", async (request) => {
    request.startTime = Date.now();
  });

  // /mcp authenticates and meters itself (it hijacks the reply, so onResponse never fires for it).
  app.addHook("preHandler", async (request) => {
    if (isPublicPath(request.url) || request.url.startsWith("/mcp")) return;
    const auth = await authenticate(request);
    authorize(auth, capabilityForUrl(request.url));
    if (auth.role === "master") {
      request.privilegedAuditId = await beginPrivilegedAudit({
        apiKeyId: auth.apiKeyId,
        method: request.method,
        route: request.routeOptions.url ?? request.url,
      });
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.auth) {
      const latency = Date.now() - (request.startTime || Date.now());
      if (request.privilegedAuditId) {
        try {
          await finalizePrivilegedAudit(
            request.privilegedAuditId,
            reply.statusCode,
            latency,
            request.privilegedAuditErrorCode,
          );
        } catch (err) {
          request.log.error({ err }, "failed to finalize privileged audit");
        }
      }
      recordUsage(request.auth.apiKeyId, request.routeOptions.url ?? request.url, reply.statusCode, latency);
    }
  });

  app.setErrorHandler((err, request, reply) => {
    request.privilegedAuditErrorCode = toAppError(err).code;
    // Log the real error server-side; clients get an opaque internal_error (see errors.ts).
    if (toAppError(err).statusCode >= 500) {
      request.log.error({ err }, "request failed");
    }
    sendError(reply, err);
  });

  await registerProductRoutes(app);
  await registerStoreRoutes(app);
  await registerPromotionRoutes(app);
  await registerBasketRoutes(app);
  await registerAdminRoutes(app);
  await registerMcpRoutes(app);

  return app;
}
