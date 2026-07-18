import type { FastifyInstance } from "fastify";
import { parseNear } from "../../lib/geo.js";
import { optimizeBasket, prepareBasket } from "../../services/basket/index.js";
import { createHandler } from "../shared/handlers.js";
import { optimizeBasketBodySchema, prepareBasketBodySchema } from "./schemas.js";
import type { BasketItemBody } from "./schemas.js";

function mapBasketItems(items: BasketItemBody[]) {
  return items.map((item) => ({
    productId: item.product_id,
    gtin: item.gtin,
    query: item.query,
    qty: item.pack_qty ?? item.qty,
    amount: item.amount,
    unit: item.unit,
  }));
}

export async function registerBasketRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/basket/prepare",
    createHandler({ body: prepareBasketBodySchema }, async ({ body }) => {
      const near = parseNear(body.near);
      return prepareBasket({
        items: mapBasketItems(body.items),
        city: body.city,
        near,
        radiusKm: body.radius_km,
      });
    }),
  );

  app.post(
    "/v1/basket/optimize",
    createHandler({ body: optimizeBasketBodySchema }, async ({ body }) => {
      const near = parseNear(body.near);
      return optimizeBasket({
        items: mapBasketItems(body.items),
        city: body.city,
        near,
        radiusKm: body.radius_km,
        includeClub: body.include_club,
        storesLimit: body.stores_limit,
      });
    }),
  );
}
