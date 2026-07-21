import type { FastifyInstance } from "fastify";
import { resolveLocationInput } from "../../lib/locationInput.js";
import { optimizeBasket } from "../../services/basket/index.js";
import type {
  BasketOptimizeRequest,
  BasketResolutionMode,
  BasketResponseDetail,
} from "../../services/basket/types.js";
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

function mapResolutionMode(value: "fast" | "strict"): BasketResolutionMode {
  switch (value) {
    case "fast":
      return "fast";
    case "strict":
      return "strict";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function geocodeStrategyForResolutionMode(
  mode: BasketResolutionMode,
): "fast" | "precise" {
  switch (mode) {
    case "fast":
      return "fast";
    case "strict":
      return "precise";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function mapResponseDetail(value: "summary" | "standard" | "debug"): BasketResponseDetail {
  switch (value) {
    case "summary":
      return "summary";
    case "standard":
      return "standard";
    case "debug":
      return "debug";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
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
        const resolutionMode = mapResolutionMode(initial.resolution_mode);
        const loc = await resolveLocationInput(
          {
            city: initial.city,
            near: initial.near,
            location: initial.location,
            radiusKm: initial.radius_km,
          },
          { geocodeStrategy: geocodeStrategyForResolutionMode(resolutionMode) },
        );
        request = {
          items: initial.items.map((item) => ({
            productId: item.product_id,
            gtin: item.gtin,
            query: item.query,
            packQty: item.pack_qty,
            amount: item.amount,
            unit: item.unit,
          })),
          city: loc.city,
          near: loc.near,
          radiusKm: loc.radiusKm,
          locationOrigin: loc.locationOrigin,
          geocodeMs: loc.geocodeMs,
          includeClub: initial.include_club,
          storesLimit: initial.stores_limit,
          distancePenaltyPerKm: initial.distance_penalty_per_km,
          verbose: initial.verbose,
          resolutionMode,
          responseDetail: mapResponseDetail(initial.response_detail),
        };
      }
      return optimizeBasket(request, continuationOptions());
    }),
  );
}
