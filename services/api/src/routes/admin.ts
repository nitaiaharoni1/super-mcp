import type { FastifyInstance } from "fastify";
import { AppError } from "@super-mcp/shared";
import { query } from "@super-mcp/db";

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

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/usage", async (request) => {
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
      data: {
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
      },
    };
  });
}
