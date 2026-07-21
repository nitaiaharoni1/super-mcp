import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { optimizeBasket } from "../../../services/basket/index.js";
import type {
  BasketResolutionMode,
  BasketResponseDetail,
} from "../../../services/basket/types.js";
import { DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, resolveToolLocation } from "../shared/location.js";

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

function mapResolutionMode(value: "fast" | "strict" | undefined): BasketResolutionMode {
  const mode = value ?? "fast";
  switch (mode) {
    case "fast":
      return "fast";
    case "strict":
      return "strict";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function mapResponseDetail(
  responseDetail: "summary" | "standard" | "debug" | undefined,
  verbose: boolean | undefined,
): BasketResponseDetail {
  if (responseDetail != null) {
    switch (responseDetail) {
      case "summary":
        return "summary";
      case "standard":
        return "standard";
      case "debug":
        return "debug";
      default: {
        const exhaustive: never = responseDetail;
        return exhaustive;
      }
    }
  }
  if (verbose === true) return "debug";
  return "summary";
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
        "selectionEffect: representative→commodity peers, brand_family→same-brand compatible packs " +
        "(larger packs may appear as alternative_available), pin→exact SKU. " +
        "Never reconstruct items and do not call search_products per line. " +
        `Initial calls require city, near, and/or location (default ${DEFAULT_RADIUS_KM}km when a point is set). ` +
        "Prefer location for neighborhoods/addresses (e.g. 'נווה עמל, הרצליה'); near remains lat,lng.",
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
        resolution_mode: z
          .enum(["fast", "strict"])
          .optional()
          .default("fast")
          .describe(
            "fast returns a best-effort priced basket in one call; strict pauses for material ambiguity.",
          ),
        // No field default: omitted must stay undefined so mapResponseDetail can
        // upgrade verbose:true → debug (same as REST transform on absent field).
        response_detail: z
          .enum(["summary", "standard", "debug"])
          .optional()
          .describe("Controls response size. Use debug only for diagnostics."),
      },
    },
    async (args) => {
      if (args.continuation) {
        if (
          args.items?.length ||
          args.city != null ||
          args.near != null ||
          args.location != null
        ) {
          throw new AppError(
            "bad_request",
            "resume optimize_basket accepts only continuation and answers",
            400,
          );
        }
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
      if (args.answers?.length) {
        throw new AppError(
          "bad_request",
          "answers require continuation; use resume form of optimize_basket",
          400,
        );
      }
      if (!args.items?.length) {
        throw new AppError("bad_request", "initial optimize_basket requires items", 400);
      }
      if (!args.city && !args.near && !args.location) {
        throw new AppError(
          "bad_request",
          "initial optimize_basket requires city, near, or location",
          400,
        );
      }
      const loc = await resolveToolLocation(args);
      return optimizeBasket(
        {
          items: mapBasketItems(args.items),
          city: loc.city,
          near: loc.near,
          radiusKm: loc.radiusKm,
          locationOrigin: loc.locationOrigin,
          includeClub: args.include_club,
          storesLimit: args.stores_limit,
          distancePenaltyPerKm: args.distance_penalty_per_km,
          verbose: args.verbose,
          resolutionMode: mapResolutionMode(args.resolution_mode),
          responseDetail: mapResponseDetail(args.response_detail, args.verbose),
        },
        continuationOptions(),
      );
    },
  );
}
