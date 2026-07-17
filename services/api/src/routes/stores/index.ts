import type { FastifyInstance } from "fastify";
import { parseNear } from "../../lib/geo.js";
import { listChains, listStores } from "../../services/stores/index.js";
import { createHandler } from "../shared/handlers.js";
import { storesQuerySchema } from "./schemas.js";

export async function registerStoreRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/chains",
    createHandler({}, async () => listChains()),
  );

  app.get(
    "/v1/stores",
    createHandler({ query: storesQuerySchema }, async ({ query }) => {
      const near = parseNear(query.near);
      return listStores({ chain: query.chain, city: query.city, near, radiusKm: query.radius_km });
    }),
  );
}

/** @deprecated Use registerStoreRoutes — kept for callers that still import the old name. */
export const registerChainRoutes = registerStoreRoutes;
