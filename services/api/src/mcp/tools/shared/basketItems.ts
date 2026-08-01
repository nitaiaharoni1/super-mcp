import { z } from "zod";
import { stripRedundantPackCountUnit } from "../../../lib/basketItemQuantity.js";

/**
 * One shopping-list line, as an MCP tool accepts it.
 *
 * Shared by optimize_basket and optimize_delivery. The two surfaces optimise
 * different things, but "two tins of tuna" is the same request either way, and a
 * second copy of these mutual-exclusion refinements would drift: an item accepted
 * by one tool and rejected by the other is a confusing failure for an agent that
 * has just been told to switch surfaces.
 */
export const mcpBasketItemSchema = z
  .object({
    product_id: z.string().uuid().optional().describe("Canonical product UUID, if known."),
    gtin: z.string().min(1).optional().describe("GTIN/barcode, if known."),
    query: z.string().min(1).optional().describe("Free-text product name."),
    pack_qty: z
      .number()
      .positive()
      .optional()
      .describe(
        "Number of product packs to buy. Prefer pack_qty alone (no unit). " +
          "Count units unit/units/יח sent with pack_qty are ignored.",
      ),
    amount: z
      .number()
      .positive()
      .optional()
      .describe("Physical amount, e.g. 1.5 with unit=kg. Mutually exclusive with pack_qty."),
    unit: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Required with amount: kg, g, L, ml, unit, יח, etc. " +
          "Do not pair mass/volume units with pack_qty.",
      ),
  })
  .strict()
  // Agents often send pack_qty with unit="unit"/"יח"; strip before mutual-exclusion checks.
  .transform(stripRedundantPackCountUnit)
  .refine(
    (item) =>
      [item.product_id, item.gtin, item.query].filter((value) => value != null).length === 1,
    "each item requires exactly one identifier: product_id, gtin, or query",
  )
  .refine(
    (item) => Number(item.pack_qty != null) + Number(item.amount != null) === 1,
    "each item requires exactly one quantity source: pack_qty or amount + unit",
  )
  .refine((item) => item.amount == null || item.unit != null, "amount requires unit")
  .refine((item) => item.amount != null || item.unit == null, "unit requires amount");


export const mcpAnswerSchema = z
  .object({
    item_index: z.number().int().min(0),
    product_id: z.string().uuid(),
  })
  .strict();

/** Map validated tool items onto the service layer's item shape. */
export function mapMcpItems(
  items: Array<z.infer<typeof mcpBasketItemSchema>>,
): Array<{
  productId?: string;
  gtin?: string;
  query?: string;
  packQty?: number;
  amount?: number;
  unit?: string;
}> {
  return items.map((item) => ({
    productId: item.product_id,
    gtin: item.gtin,
    query: item.query,
    packQty: item.pack_qty,
    amount: item.amount,
    unit: item.unit,
  }));
}
