import { z } from "zod";
import { geoQueryFields } from "../shared/schemas.js";

export const storesQuerySchema = z.object({
  chain: z.string().trim().optional(),
  ...geoQueryFields,
});
