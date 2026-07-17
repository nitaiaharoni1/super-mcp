import { z } from "zod";
import { DEFAULT_RADIUS_KM } from "../../lib/defaults.js";

export const uuidParamSchema = z.object({ id: z.string().uuid() });

export const geoQueryFields = {
  city: z.string().trim().optional(),
  near: z.string().trim().optional(),
  radius_km: z.coerce.number().positive().max(200).optional().default(DEFAULT_RADIUS_KM),
} as const;

export const geoQuerySchema = z.object(geoQueryFields);
