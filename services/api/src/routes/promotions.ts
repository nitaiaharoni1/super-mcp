import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listPromotions } from "../services/promotions.js";

const promotionsQuerySchema = z.object({
  store_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
});

export async function registerPromotionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/promotions", async (request) => {
    const q = promotionsQuerySchema.parse(request.query);
    const data = await listPromotions({ storeId: q.store_id, productId: q.product_id, activeOnly: q.active });
    return { data };
  });
}
