import type { FastifyInstance } from "fastify";
import { getReadiness } from "../../services/readiness/getReadiness.js";

/** Register separately from /health so liveness remains dependency-free. */
export async function registerReadinessRoute(app: FastifyInstance): Promise<void> {
  app.get("/ready", async (_request, reply) => {
    const report = await getReadiness();
    return reply.code(report.status === "ready" ? 200 : 503).send(report);
  });
}
