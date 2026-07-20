import { z } from "zod";
import { geoQueryFields, refineGeoFields } from "../shared/schemas.js";

export const storesQuerySchema = z
  .object({
    chain: z.string().trim().optional(),
    ...geoQueryFields,
  })
  .refine(refineGeoFields, { message: "provide either near or location, not both" });
