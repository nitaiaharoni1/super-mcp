import type { FastifyInstance } from "fastify";
import {
  applyLocationOriginHonesty,
  resolveLocationInput,
} from "../../lib/locationInput.js";
import { resolveStoreLocation } from "../../lib/resolveStoreLocation.js";
import { listChains } from "../../services/stores/index.js";
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
      const loc = await resolveLocationInput({
        city: query.city,
        near: query.near,
        location: query.location,
        radiusKm: query.radius_km,
      });
      const result = await resolveStoreLocation({
        chain: query.chain,
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
      });
      return {
        stores: result.stores,
        location: applyLocationOriginHonesty(result.location, loc.locationOrigin),
      };
    }),
  );
}
