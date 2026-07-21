import { z } from "zod";
import { geoQueryFields, refineGeoFields } from "../shared/schemas.js";

export const basketItemSchema = z
  .object({
    product_id: z.string().uuid().optional(),
    gtin: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).optional(),
    pack_qty: z.coerce.number().positive().optional(),
    amount: z.coerce.number().positive().optional(),
    unit: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (item) =>
      [item.product_id, item.gtin, item.query].filter((value) => value != null).length === 1,
    "each item requires exactly one identifier: product_id, gtin, or query",
  )
  .refine(
    (item) => Number(item.pack_qty != null) + Number(item.amount != null) === 1,
    "each item requires exactly one quantity source: pack_qty or amount + unit",
  )
  .refine((item) => item.amount == null || item.unit != null, "amount requires unit")
  .refine((item) => item.amount != null || item.unit == null, "unit requires amount");

export type BasketItemBody = z.infer<typeof basketItemSchema>;

const basketLocationBodyShape = {
  ...geoQueryFields,
};

export const basketInitialBodySchema = z
  .object({
    items: z.array(basketItemSchema).min(1).max(50),
    ...basketLocationBodyShape,
    include_club: z.boolean().optional().default(true),
    stores_limit: z.coerce.number().int().min(0).max(500).optional(),
    distance_penalty_per_km: z.coerce.number().min(0).max(100).optional(),
    verbose: z.coerce.boolean().optional(),
    resolution_mode: z
      .enum(["fast", "strict"])
      .optional()
      .describe(
        "fast returns a best-effort priced basket in one call; strict pauses for material ambiguity.",
      ),
    response_detail: z
      .enum(["summary", "standard", "debug"])
      .optional()
      .describe("Controls response size. Use debug only for diagnostics."),
  })
  .strict()
  .refine(refineGeoFields, { message: "provide either near or location, not both" })
  .refine((body) => Boolean(body.city || body.near || body.location), {
    message: "provide city, near, or location",
  })
  .transform((body) => ({
    ...body,
    // Defaults applied after refine so verbose→debug runs only when response_detail is absent.
    resolution_mode: body.resolution_mode ?? "fast",
    response_detail:
      body.response_detail ?? (body.verbose === true ? "debug" : "summary"),
  }));

export const basketResumeBodySchema = z
  .object({
    continuation: z.string().min(1),
    answers: z
      .array(
        z
          .object({
            item_index: z.number().int().min(0),
            product_id: z.string().uuid(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const optimizeBasketBodySchema = z.union([
  basketResumeBodySchema,
  basketInitialBodySchema,
]);
