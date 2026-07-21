import type { FastifyInstance } from "fastify";
import { AppError } from "@super-mcp/shared";
import { query } from "@super-mcp/db";
import { z } from "zod";
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "../../services/apiKeys.js";
import { createHandler } from "../shared/handlers.js";

interface TotalsRow {
  total: string;
  last_24h: string;
  last_minute: string;
}

interface RouteBreakdownRow {
  route: string;
  count: string;
  avg_latency_ms: string | null;
  last_used: string;
}

const createKeyBody = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(["standard", "master"]).default("standard"),
  rateLimitPerMinute: z.number().int().positive().max(1_000_000).default(60),
  expiresAt: z.string().datetime().nullable().optional(),
});

const keyParams = z.object({ id: z.string().uuid() });

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/admin/keys",
    createHandler({}, async () => listApiKeys()),
  );

  app.post(
    "/v1/admin/keys",
    createHandler({ body: createKeyBody }, async ({ body }, request) => {
      const auth = request.auth;
      if (!auth) throw new AppError("unauthorized", "Missing API key", 401);
      // Masters are break-glass only — mint via CLI (`pnpm create-key -- --role=master`), not HTTP.
      if (body.role === "master") {
        throw new AppError(
          "forbidden",
          "Master API keys cannot be created via HTTP; use the create-key CLI",
          403,
        );
      }
      return createApiKey(body, auth.apiKeyId);
    }),
  );

  app.post(
    "/v1/admin/keys/:id/rotate",
    createHandler({ params: keyParams }, async ({ params }, request) => {
      const auth = request.auth;
      if (!auth) throw new AppError("unauthorized", "Missing API key", 401);
      return rotateApiKey(params.id, auth.apiKeyId);
    }),
  );

  app.post(
    "/v1/admin/keys/:id/revoke",
    createHandler({ params: keyParams }, async ({ params }, request) => {
      const auth = request.auth;
      if (!auth) throw new AppError("unauthorized", "Missing API key", 401);
      await revokeApiKey(params.id, auth.apiKeyId);
      return { revoked: true };
    }),
  );

  app.get(
    "/v1/admin/usage",
    createHandler({}, async () => {
      const totalsRes = await query<TotalsRow>(
        `SELECT
           count(*)::text AS total,
           count(*) FILTER (WHERE created_at > now() - interval '1 day')::text AS last_24h,
           count(*) FILTER (WHERE created_at > now() - interval '1 minute')::text AS last_minute
         FROM usage_event`,
      );
      const totals = totalsRes.rows[0];
      return {
        totalRequests: Number(totals?.total ?? 0),
        requestsLast24h: Number(totals?.last_24h ?? 0),
        requestsLastMinute: Number(totals?.last_minute ?? 0),
      };
    }),
  );

  app.get(
    "/v1/usage",
    createHandler({}, async (_input, request) => {
      const auth = request.auth;
      if (!auth) {
        throw new AppError("unauthorized", "Missing API key", 401);
      }

      const totalsRes = await query<TotalsRow>(
        `SELECT
           count(*)::text AS total,
           count(*) FILTER (WHERE created_at > now() - interval '1 day')::text AS last_24h,
           count(*) FILTER (WHERE created_at > now() - interval '1 minute')::text AS last_minute
         FROM usage_event
         WHERE api_key_id = $1`,
        [auth.apiKeyId],
      );

      const byRouteRes = await query<RouteBreakdownRow>(
        `SELECT route, count(*)::text AS count, avg(latency_ms)::text AS avg_latency_ms, max(created_at) AS last_used
         FROM usage_event
         WHERE api_key_id = $1
         GROUP BY route
         ORDER BY count(*) DESC
         LIMIT 50`,
        [auth.apiKeyId],
      );

      const totals = totalsRes.rows[0];

      return {
        apiKey: { id: auth.apiKeyId, name: auth.name, rateLimitPerMinute: auth.rateLimitPerMinute },
        totalRequests: Number(totals?.total ?? 0),
        requestsLast24h: Number(totals?.last_24h ?? 0),
        requestsLastMinute: Number(totals?.last_minute ?? 0),
        byRoute: byRouteRes.rows.map((r) => ({
          route: r.route,
          count: Number(r.count),
          avgLatencyMs: r.avg_latency_ms != null ? Math.round(Number(r.avg_latency_ms)) : null,
          lastUsed: r.last_used,
        })),
      };
    }),
  );
}
