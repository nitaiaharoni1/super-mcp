import { z } from "zod";
import type { GeocodeStrategy } from "@super-mcp/db";
import {
  resolveLocationInput,
  type ResolvedLocationInput,
} from "../../../lib/locationInput.js";
import { DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import type { GeoPoint } from "../../../lib/geo.js";

/** Shared location filter fields, reused across tools that scope results to a place. */
export const locationShape = {
  city: z
    .string()
    .optional()
    .describe(
      "City name in Hebrew or English (also accepts CBS locality codes). " +
        "Aliases resolve to one place — e.g. 'הרצליה', 'Herzliya', and '6400' are the same filter. " +
        "May be combined with location as a disambiguation hint.",
    ),
  near: z
    .string()
    .optional()
    .describe("'lat,lng' string, e.g. '32.078,34.774', to find stores near a point."),
  location: z
    .string()
    .min(3)
    .max(300)
    .optional()
    .describe(
      "Free-text neighborhood or address in Israel, e.g. 'נווה עמל, הרצליה'. " +
        "Resolved to coordinates via cached Nominatim. Do not combine with near.",
    ),
  radius_km: z
    .number()
    .positive()
    .max(200)
    .optional()
    .describe(
      `Search radius in km around the resolved point. Defaults to ${DEFAULT_RADIUS_KM}km when near or location is set. Ignored without a point.`,
    ),
};

/** @deprecated Prefer resolveToolLocation — kept for tests that only need lat,lng parsing. */
export { parseNear as toGeo } from "../../../lib/geo.js";

export type ToolLocationArgs = {
  city?: string;
  near?: string;
  location?: string;
  radius_km?: number;
};

function mapGeocodeStrategy(
  strategy: GeocodeStrategy | undefined,
): GeocodeStrategy {
  const value = strategy ?? "precise";
  switch (value) {
    case "fast":
      return "fast";
    case "precise":
      return "precise";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

/** Resolve MCP/REST location args into city / near GeoPoint / radius + provenance. */
export async function resolveToolLocation(
  args: ToolLocationArgs,
  opts: { geocodeStrategy?: GeocodeStrategy } = {},
): Promise<ResolvedLocationInput> {
  return resolveLocationInput(
    {
      city: args.city,
      near: args.near,
      location: args.location,
      radiusKm: args.radius_km,
    },
    { geocodeStrategy: mapGeocodeStrategy(opts.geocodeStrategy) },
  );
}

export type { GeoPoint, ResolvedLocationInput };
