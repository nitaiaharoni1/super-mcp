import { z } from "zod";

export const promotionsQuerySchema = z.object({
  store_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
});
