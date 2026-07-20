import type { FastifyInstance } from "fastify";
import { AppError } from "@super-mcp/shared";
import { resolveLocationInput } from "../../lib/locationInput.js";
import {
  getProductById,
  getProductHistory,
  getProductPrices,
} from "../../services/products/index.js";
import { searchProducts } from "../../services/search/index.js";
import { suggestSubstitutes } from "../../services/substitutes/index.js";
import { createHandler } from "../shared/handlers.js";
import { uuidParamSchema } from "../shared/schemas.js";
import {
  historyQuerySchema,
  pricesQuerySchema,
  searchQuerySchema,
  substitutesQuerySchema,
} from "./schemas.js";

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/products",
    createHandler({ query: searchQuerySchema }, async ({ query }) => {
      const loc = await resolveLocationInput({
        city: query.city,
        near: query.near,
        location: query.location,
        radiusKm: query.radius_km,
      });
      return searchProducts({
        q: query.q,
        category: query.category,
        brand: query.brand,
        gtin: query.gtin,
        limit: query.limit,
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        storeIds: query.store_id ? [query.store_id] : undefined,
        inStockOnly: query.in_stock_only,
      });
    }),
  );

  app.get(
    "/v1/products/:id",
    createHandler({ params: uuidParamSchema }, async ({ params }) => {
      const product = await getProductById(params.id);
      if (!product) {
        throw new AppError("not_found", "Product not found", 404, { id: params.id });
      }
      return product;
    }),
  );

  app.get(
    "/v1/products/:id/prices",
    createHandler({ params: uuidParamSchema, query: pricesQuerySchema }, async ({ params, query }) => {
      const loc = await resolveLocationInput({
        city: query.city,
        near: query.near,
        location: query.location,
        radiusKm: query.radius_km,
      });
      return getProductPrices(params.id, {
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        includeClub: query.include_club,
        sortBy: query.sort,
      });
    }),
  );

  app.get(
    "/v1/products/:id/substitutes",
    createHandler({ params: uuidParamSchema, query: substitutesQuerySchema }, async ({ params, query }) => {
      const loc = await resolveLocationInput({
        city: query.city,
        near: query.near,
        location: query.location,
        radiusKm: query.radius_km,
      });
      return suggestSubstitutes(params.id, {
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        limit: query.limit,
        cheaperOnly: query.cheaper_only,
      });
    }),
  );

  app.get(
    "/v1/products/:id/history",
    createHandler({ params: uuidParamSchema, query: historyQuerySchema }, async ({ params, query }) => {
      return getProductHistory(params.id, query);
    }),
  );
}
