import type { FastifyInstance } from "fastify";
import { parseNear } from "../../lib/geo.js";
import { optimizeBasket } from "../../services/basket/index.js";
import type { BasketOptimizeRequest } from "../../services/basket/types.js";
import { createHandler } from "../shared/handlers.js";
import {
  basketInitialBodySchema,
  basketResumeBodySchema,
  optimizeBasketBodySchema,
} from "./schemas.js";

function continuationOptions() {
  return {
    continuationSecret: process.env.BASKET_CONTINUATION_SECRET ?? "",
  };
}

export async function registerBasketRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/basket/optimize",
    createHandler({ body: optimizeBasketBodySchema }, async ({ body }) => {
      const resume = basketResumeBodySchema.safeParse(body);
      let request: BasketOptimizeRequest;
      if (resume.success) {
        request = {
          continuation: resume.data.continuation,
          answers: resume.data.answers.map((answer) => ({
            itemIndex: answer.item_index,
            productId: answer.product_id,
          })),
        };
      } else {
        const initial = basketInitialBodySchema.parse(body);
        request = {
          items: initial.items.map((item) => ({
            productId: item.product_id,
            gtin: item.gtin,
            query: item.query,
            packQty: item.pack_qty,
            amount: item.amount,
            unit: item.unit,
          })),
          city: initial.city,
          near: parseNear(initial.near),
          radiusKm: initial.radius_km,
          includeClub: initial.include_club,
          storesLimit: initial.stores_limit,
          distancePenaltyPerKm: initial.distance_penalty_per_km,
          verbose: initial.verbose,
        };
      }
      return optimizeBasket(request, continuationOptions());
    }),
  );
}
