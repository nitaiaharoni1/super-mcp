import { z } from "zod";
import { DEFAULT_RADIUS_KM } from "../../lib/defaults.js";
import { geoQueryFields } from "../shared/schemas.js";

export const basketItemSchema = z
  .object({
    product_id: z.string().uuid().optional(),
    gtin: z.string().trim().optional(),
    query: z.string().trim().optional(),
    qty: z.coerce.number().positive().optional(),
    amount: z.coerce.number().positive().optional(),
    unit: z.string().trim().optional(),
  })
  .refine((item) => Boolean(item.product_id || item.gtin || item.query), {
    message: "each item requires one of product_id, gtin, or query",
  })
  .refine((item) => item.qty != null || item.amount != null, {
    message: "each item requires qty (pack count) or amount + unit",
  })
  .refine((item) => item.amount == null || Boolean(item.unit?.trim()), {
    message: "amount requires unit (kg, g, L, ml, unit, יח, …)",
  });

export const optimizeBasketBodySchema = z.object({
  items: z.array(basketItemSchema).min(1).max(50),
  ...geoQueryFields,
  include_club: z.boolean().optional().default(true),
  stores_limit: z.coerce.number().int().min(0).max(500).optional(),
});
