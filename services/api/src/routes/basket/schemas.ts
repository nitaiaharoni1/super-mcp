import { z } from "zod";
import { DEFAULT_RADIUS_KM } from "../../lib/defaults.js";
import { geoQueryFields } from "../shared/schemas.js";

export const basketItemSchema = z
  .object({
    product_id: z.string().uuid().optional(),
    gtin: z.string().trim().optional(),
    query: z.string().trim().optional(),
    pack_qty: z.coerce.number().positive().optional(),
    qty: z.coerce.number().positive().optional(),
    amount: z.coerce.number().positive().optional(),
    unit: z.string().trim().optional(),
  })
  .refine((item) => Boolean(item.product_id || item.gtin || item.query), {
    message: "each item requires one of product_id, gtin, or query",
  })
  .refine((item) => item.pack_qty == null || item.qty == null, {
    message: "pack_qty and deprecated qty are mutually exclusive; supply only one",
  })
  .refine((item) => item.pack_qty != null || item.qty != null || item.amount != null, {
    message: "each item requires pack_qty (pack count) or amount + unit",
  })
  .refine((item) => item.amount == null || Boolean(item.unit?.trim()), {
    message: "amount requires unit (kg, g, L, ml, unit, יח, …)",
  });

export type BasketItemBody = z.infer<typeof basketItemSchema>;

const basketLocationBodyShape = {
  ...geoQueryFields,
};

export const prepareBasketBodySchema = z.object({
  items: z.array(basketItemSchema).min(1).max(50),
  ...basketLocationBodyShape,
});

export const optimizeBasketBodySchema = z.object({
  items: z.array(basketItemSchema).min(1).max(50),
  ...basketLocationBodyShape,
  include_club: z.boolean().optional().default(true),
  stores_limit: z.coerce.number().int().min(0).max(500).optional(),
});
