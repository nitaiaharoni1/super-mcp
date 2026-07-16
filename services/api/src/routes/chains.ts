import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseNear } from "../lib/geo.js";
import { listChains, listStores } from "../services/stores.js";

const storesQuerySchema = z.object({
  chain: z.string().trim().optional(),
  city: z.string().trim().optional(),
  near: z.string().trim().optional(),
  radius_km: z.coerce.number().positive().max(200).optional(),
});

export async function registerChainRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/chains", async () => {
    const data = await listChains();
    return { data };
  });

  app.get("/v1/stores", async (request) => {
    const q = storesQuerySchema.parse(request.query);
    const near = parseNear(q.near);
    const data = await listStores({ chain: q.chain, city: q.city, near, radiusKm: q.radius_km });
    return { data };
  });
}
