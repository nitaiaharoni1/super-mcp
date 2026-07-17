import { z } from "zod";
import { DEFAULT_RADIUS_KM } from "../../lib/defaults.js";
import { geoQueryFields } from "../shared/schemas.js";

export const searchQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  category: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  gtin: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  ...geoQueryFields,
  radius_km: z.coerce.number().positive().max(200).optional(),
  store_id: z.string().uuid().optional(),
  in_stock_only: z.coerce.boolean().optional().default(false),
});

export const pricesQuerySchema = z.object({
  ...geoQueryFields,
  include_club: z.coerce.boolean().optional().default(true),
  sort: z.enum(["price", "unit_price"]).optional().default("price"),
});

export const substitutesQuerySchema = z.object({
  ...geoQueryFields,
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  cheaper_only: z.coerce.boolean().optional().default(true),
});

export const historyQuerySchema = z.object({
  store_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
