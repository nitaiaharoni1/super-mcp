import { z } from "zod";
import { DEFAULT_RADIUS_KM } from "../../lib/defaults.js";

export const uuidParamSchema = z.object({ id: z.string().uuid() });

/** Trimmed free-text location; empty string treated as absent. */
const optionalLocation = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => value == null || value.length >= 3, {
    message: "location must be between 3 and 300 characters",
  });

export const geoQueryFields = {
  city: z.string().trim().optional(),
  near: z.string().trim().optional(),
  location: optionalLocation,
  radius_km: z.coerce.number().positive().max(200).optional().default(DEFAULT_RADIUS_KM),
} as const;

/** Reject near+location; used by basket (required location) and optional surfaces. */
export function refineGeoFields<T extends { city?: string; near?: string; location?: string }>(
  body: T,
): boolean {
  return !(body.near && body.location);
}

export const geoQuerySchema = z
  .object(geoQueryFields)
  .refine(refineGeoFields, { message: "provide either near or location, not both" });
