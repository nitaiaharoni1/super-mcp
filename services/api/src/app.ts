import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { authenticate, recordUsage } from "./auth.js";
import { sendError, toAppError } from "./lib/errors.js";
import { getOpenApiSpec } from "./openapi.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerChainRoutes } from "./routes/chains.js";
import { registerPromotionRoutes } from "./routes/promotions.js";
import { registerBasketRoutes } from "./routes/basket.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerMcpRoutes } from "./mcp/server.js";

const PUBLIC_PATHS = new Set(["/health", "/openapi.json"]);

function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PUBLIC_PATHS.has(path);
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Keys can arrive via ?api_key=<key> (auth.ts). Strip the query string from the
      // logged URL and redact the Authorization header so a raw key never reaches the logs.
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

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  app.get("/openapi.json", async () => getOpenApiSpec());

  app.addHook("onRequest", async (request) => {
    request.startTime = Date.now();
  });

  // /mcp authenticates and meters itself (it hijacks the reply, so onResponse never fires for it).
  app.addHook("preHandler", async (request) => {
    if (isPublicPath(request.url) || request.url.startsWith("/mcp")) return;
    await authenticate(request);
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.auth) {
      const latency = Date.now() - (request.startTime || Date.now());
      recordUsage(request.auth.apiKeyId, request.routeOptions.url ?? request.url, reply.statusCode, latency);
    }
  });

  app.setErrorHandler((err, request, reply) => {
    // Log the real error server-side; clients get an opaque internal_error (see errors.ts).
    if (toAppError(err).statusCode >= 500) {
      request.log.error({ err }, "request failed");
    }
    sendError(reply, err);
  });

  await registerProductRoutes(app);
  await registerChainRoutes(app);
  await registerPromotionRoutes(app);
  await registerBasketRoutes(app);
  await registerAdminRoutes(app);
  await registerMcpRoutes(app);

  return app;
}
