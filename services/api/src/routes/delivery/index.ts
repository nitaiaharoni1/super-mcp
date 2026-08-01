import type { FastifyInstance } from "fastify";
import { resolveLocationInput } from "../../lib/locationInput.js";
import {
  getDeliveryTerms,
  listDeliveryOptions,
  optimizeDelivery,
} from "../../services/delivery/index.js";
import type { DeliveryOptimizeRequest } from "../../services/delivery/index.js";
import { createHandler } from "../shared/handlers.js";
import {
  deliveryInitialBodySchema,
  deliveryOptionsQuerySchema,
  deliveryResumeBodySchema,
  deliveryTermsParamsSchema,
  optimizeDeliveryBodySchema,
} from "./schemas.js";

function continuationOptions() {
  return { continuationSecret: process.env.BASKET_CONTINUATION_SECRET ?? "" };
}

export async function registerDeliveryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/delivery/optimize",
    createHandler({ body: optimizeDeliveryBodySchema }, async ({ body }) => {
      const resume = deliveryResumeBodySchema.safeParse(body);
      let request: DeliveryOptimizeRequest;
      if (resume.success) {
        request = {
          continuation: resume.data.continuation,
          answers: resume.data.answers.map((answer) => ({
            itemIndex: answer.item_index,
            productId: answer.product_id,
          })),
        };
      } else {
        const initial = deliveryInitialBodySchema.parse(body);
        // A delivery address is worth geocoding precisely: a coverage polygon or
        // a depot radius is tested against the point, so a city centroid turns a
        // yes/no about the shopper's street into a yes/no about the town centre.
        const loc = await resolveLocationInput(
          { city: initial.city, near: initial.near, location: initial.address },
          { geocodeStrategy: initial.address ? "precise" : "fast" },
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
          address: initial.address,
          city: loc.city,
          near: loc.near,
          preference: initial.preference,
          slotType: initial.slot_type,
          memberships: initial.memberships,
          includeClub: initial.include_club,
          includeCoupon: initial.include_coupon,
          compareInStore: initial.compare_in_store,
          resolutionMode: initial.resolution_mode,
          locationOrigin: loc.locationOrigin,
          geocodeMs: loc.geocodeMs,
        };
      }
      return optimizeDelivery(request, continuationOptions());
    }),
  );

  app.get(
    "/v1/delivery/options",
    createHandler({ query: deliveryOptionsQuerySchema }, async ({ query }) => {
      const loc = await resolveLocationInput(
        { city: query.city, near: query.near, location: query.address },
        { geocodeStrategy: query.address ? "precise" : "fast" },
      );
      return listDeliveryOptions({
        city: loc.city,
        address: query.address,
        near: loc.near,
        chainId: query.chain,
        includeUnavailable: query.include_unavailable,
      });
    }),
  );

  app.get(
    "/v1/delivery/services/:slug",
    createHandler({ params: deliveryTermsParamsSchema }, async ({ params }) =>
      getDeliveryTerms(params.slug),
    ),
  );
}
