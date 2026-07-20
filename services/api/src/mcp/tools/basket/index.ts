import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { optimizeBasket } from "../../../services/basket/index.js";
import { resolveRadiusKm, DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, toGeo } from "../shared/location.js";

const basketItemSchema = z
  .object({
    product_id: z.string().uuid().optional().describe("Canonical product UUID, if known."),
    gtin: z.string().min(1).optional().describe("GTIN/barcode, if known."),
    query: z.string().min(1).optional().describe("Free-text product name."),
    pack_qty: z.number().positive().optional().describe("Number of product packs to buy."),
    amount: z
      .number()
      .positive()
      .optional()
      .describe("Physical amount, e.g. 1.5 with unit=kg."),
    unit: z
      .string()
      .min(1)
      .optional()
      .describe("Unit for amount: kg, g, L, ml, unit, יח, etc."),
  })
  .strict()
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

const basketItemsSchema = z.array(basketItemSchema).min(1).max(50);

const answerSchema = z
  .object({
    item_index: z.number().int().min(0),
    product_id: z.string().uuid(),
  })
  .strict();

function mapBasketItems(items: z.infer<typeof basketItemsSchema>) {
  return items.map((item) => ({
    productId: item.product_id,
    gtin: item.gtin,
    query: item.query,
    packQty: item.pack_qty,
    amount: item.amount,
    unit: item.unit,
  }));
}

function continuationOptions() {
  return {
    continuationSecret: process.env.BASKET_CONTINUATION_SECRET ?? "",
  };
}

export function registerBasketTools(server: McpServer): void {
  registerTool(
    server,
    "optimize_basket",
    {
      title: "Resolve and price a shopping basket (resumable)",
      description:
        "Call once with the original shopping list. If status is needs_confirmation, ask every " +
        "returned question and call the same tool once more with only continuation and answers. " +
        "Never reconstruct items and do not call search_products per line. " +
        `Initial calls require city and/or near (default ${DEFAULT_RADIUS_KM}km).`,
      inputSchema: {
        items: basketItemsSchema.optional(),
        ...locationShape,
        continuation: z
          .string()
          .min(1)
          .optional()
          .describe("Opaque signed token from a prior needs_confirmation response."),
        answers: z
          .array(answerSchema)
          .min(1)
          .optional()
          .describe("Answers to continuation questions (resume only)."),
        include_club: z.boolean().optional(),
        stores_limit: z.number().int().min(0).max(500).optional(),
        distance_penalty_per_km: z.number().min(0).max(100).optional(),
        verbose: z.boolean().optional(),
      },
    },
    async (args) => {
      if (args.continuation) {
        if (!args.answers?.length) {
          throw new AppError("bad_request", "resume optimize_basket requires answers", 400);
        }
        return optimizeBasket(
          {
            continuation: args.continuation,
            answers: args.answers.map((a) => ({
              itemIndex: a.item_index,
              productId: a.product_id,
            })),
          },
          continuationOptions(),
        );
      }
      if (!args.items?.length) {
        throw new AppError("bad_request", "initial optimize_basket requires items", 400);
      }
      const geo = toGeo(args.near);
      return optimizeBasket(
        {
          items: mapBasketItems(args.items),
          city: args.city,
          near: geo,
          radiusKm: resolveRadiusKm(geo, args.radius_km),
          includeClub: args.include_club,
          storesLimit: args.stores_limit,
          distancePenaltyPerKm: args.distance_penalty_per_km,
          verbose: args.verbose,
        },
        continuationOptions(),
      );
    },
  );
}
