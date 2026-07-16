import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@super-mcp/shared";
import { parseNear } from "../lib/geo.js";
import {
  getProductById,
  getProductHistory,
  getProductPrices,
  searchProducts,
} from "../services/products.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const searchQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  category: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  gtin: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const pricesQuerySchema = z.object({
  city: z.string().trim().optional(),
  near: z.string().trim().optional(),
  radius_km: z.coerce.number().positive().max(200).optional().default(15),
  include_club: z.coerce.boolean().optional().default(true),
});

const historyQuerySchema = z.object({
  store_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/products", async (request) => {
    const parsed = searchQuerySchema.parse(request.query);
    const data = await searchProducts(parsed);
    return { data };
  });

  app.get("/v1/products/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const product = await getProductById(id);
    if (!product) {
      throw new AppError("not_found", "Product not found", 404, { id });
    }
    return { data: product };
  });

  app.get("/v1/products/:id/prices", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const q = pricesQuerySchema.parse(request.query);
    const near = parseNear(q.near);
    const data = await getProductPrices(id, {
      city: q.city,
      near,
      radiusKm: q.radius_km,
      includeClub: q.include_club,
    });
    return { data };
  });

  app.get("/v1/products/:id/history", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const q = historyQuerySchema.parse(request.query);
    const data = await getProductHistory(id, q);
    return { data };
  });
}
