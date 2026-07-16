import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseNear } from "../lib/geo.js";
import { DEFAULT_RADIUS_KM } from "../lib/defaults.js";
import { optimizeBasket } from "../services/basket.js";

const itemSchema = z
  .object({
    product_id: z.string().uuid().optional(),
    gtin: z.string().trim().optional(),
    query: z.string().trim().optional(),
    qty: z.coerce.number().positive(),
  })
  .refine((item) => Boolean(item.product_id || item.gtin || item.query), {
    message: "each item requires one of product_id, gtin, or query",
  });

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(50),
  city: z.string().trim().optional(),
  near: z.string().trim().optional(),
  radius_km: z.coerce.number().positive().max(200).optional().default(DEFAULT_RADIUS_KM),
  include_club: z.boolean().optional().default(true),
});

export async function registerBasketRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/basket/optimize", async (request) => {
    const body = bodySchema.parse(request.body);
    const near = parseNear(body.near);

    const result = await optimizeBasket({
      items: body.items.map((item) => ({
        productId: item.product_id,
        gtin: item.gtin,
        query: item.query,
        qty: item.qty,
      })),
      city: body.city,
      near,
      radiusKm: body.radius_km,
      includeClub: body.include_club,
    });

    return { data: result };
  });
}
