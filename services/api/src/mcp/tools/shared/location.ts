import { z } from "zod";
import { parseNear, type GeoPoint } from "../../../lib/geo.js";
import { DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";

/** Shared location filter fields, reused across tools that scope results to a place. */
export const locationShape = {
  city: z
    .string()
    .optional()
    .describe(
      "City name in Hebrew or English (also accepts CBS locality codes). " +
        "Aliases resolve to one place — e.g. 'הרצליה', 'Herzliya', and '6400' are the same filter.",
    ),
  near: z
    .string()
    .optional()
    .describe("'lat,lng' string, e.g. '32.078,34.774', to find stores near a point."),
  radius_km: z
    .number()
    .positive()
    .max(200)
    .optional()
    .describe(
      `Search radius in km around 'near'. Defaults to ${DEFAULT_RADIUS_KM}km when 'near' is set. Ignored without 'near'.`,
    ),
};

export function toGeo(near: string | undefined): GeoPoint | undefined {
  return parseNear(near);
}
