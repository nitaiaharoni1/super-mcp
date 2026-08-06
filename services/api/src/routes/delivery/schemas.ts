import { z } from "zod";
import { basketItemSchema } from "../basket/schemas.js";

/**
 * Where the order is going.
 *
 * Deliberately not `geoQueryFields`: that carries `radius_km`, which asks how far
 * the shopper will travel. Online the question is whether the storefront will
 * come to them, and the storefront's own service area answers it.
 */
const destinationShape = {
  address: z.string().trim().min(3).max(300).optional(),
  city: z.string().trim().min(1).optional(),
  near: z.string().trim().min(3).optional(),
};

export const deliveryInitialBodySchema = z
  .object({
    items: z.array(basketItemSchema).min(1).max(50),
    ...destinationShape,
    preference: z.enum(["cheapest", "balanced"]).optional(),
    slot_type: z.enum(["standard", "pickup", "express"]).optional(),
    memberships: z.array(z.string().trim().min(1)).max(10).optional(),
    include_club: z.boolean().optional().default(true),
    include_coupon: z.boolean().optional().default(true),
    resolution_mode: z.enum(["fast", "strict"]).optional(),
  })
  .strict()
  .refine(
    (body) => body.address != null || body.city != null || body.near != null,
    "a delivery destination is required: address, city, or near",
  );

export const deliveryResumeBodySchema = z
  .object({
    continuation: z.string().min(1),
    answers: z
      .array(z.object({ item_index: z.number().int().min(0), product_id: z.string().uuid() }).strict())
      .default([]),
  })
  .strict();

export const optimizeDeliveryBodySchema = z.union([
  deliveryResumeBodySchema,
  deliveryInitialBodySchema,
]);

export const deliveryOptionsQuerySchema = z
  .object({
    ...destinationShape,
    chain: z.string().trim().min(1).optional(),
    include_unavailable: z.coerce.boolean().optional(),
  })
  .strict();

export const deliveryTermsParamsSchema = z
  .object({ slug: z.string().trim().min(1) })
  .strict();
