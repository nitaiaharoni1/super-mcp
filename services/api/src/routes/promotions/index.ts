import type { FastifyInstance } from "fastify";
import { listPromotions } from "../../services/promotions/index.js";
import { createHandler } from "../shared/handlers.js";
import { promotionsQuerySchema } from "./schemas.js";

export async function registerPromotionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/promotions",
    createHandler({ query: promotionsQuerySchema }, async ({ query }) =>
      listPromotions({ storeId: query.store_id, productId: query.product_id, activeOnly: query.active }),
    ),
  );
}
