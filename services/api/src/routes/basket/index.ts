import type { FastifyInstance } from "fastify";
import { parseNear } from "../../lib/geo.js";
import { optimizeBasket } from "../../services/basket/index.js";
import { createHandler } from "../shared/handlers.js";
import { optimizeBasketBodySchema } from "./schemas.js";

export async function registerBasketRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/basket/optimize",
    createHandler({ body: optimizeBasketBodySchema }, async ({ body }) => {
      const near = parseNear(body.near);
      return optimizeBasket({
        items: body.items.map((item) => ({
          productId: item.product_id,
          gtin: item.gtin,
          query: item.query,
          qty: item.qty,
          amount: item.amount,
          unit: item.unit,
        })),
        city: body.city,
        near,
        radiusKm: body.radius_km,
        includeClub: body.include_club,
        storesLimit: body.stores_limit,
      });
    }),
  );
}
