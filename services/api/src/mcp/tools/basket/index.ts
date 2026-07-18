import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { optimizeBasket, prepareBasket } from "../../../services/basket/index.js";
import { resolveRadiusKm, DEFAULT_RADIUS_KM } from "../../../lib/defaults.js";
import { registerTool } from "../register.js";
import { locationShape, toGeo } from "../shared/location.js";

const basketItemSchema = z
  .object({
    product_id: z.string().uuid().optional().describe("Canonical product UUID, if known."),
    gtin: z.string().optional().describe("GTIN/barcode, if known."),
    query: z.string().optional().describe("Free-text product name, used if product_id/gtin are unknown."),
    pack_qty: z
      .number()
      .positive()
      .optional()
      .describe("Number of product packs to buy."),
    qty: z
      .number()
      .positive()
      .optional()
      .describe("Deprecated alias for pack_qty. Do not supply both."),
    amount: z
      .number()
      .positive()
      .optional()
      .describe("Physical amount, e.g. 1.5 with unit=kg. Converted to packs or weighted qty."),
    unit: z
      .string()
      .optional()
      .describe("Unit for amount: kg, g, L, ml, unit, יח, קג, etc. For 20 pitas use amount=20, unit=יח."),
  })
  .refine((item) => !(item.pack_qty != null && item.qty != null), {
    message: "pack_qty and deprecated qty are mutually exclusive; supply only one",
  })
  .describe("Shopping list line: product_id|gtin|query plus pack_qty (deprecated: qty) or amount+unit.");

const basketItemsSchema = z
  .array(basketItemSchema)
  .min(1)
  .max(50)
  .describe(
    "Shopping list. Each item needs product_id|gtin|query and pack_qty (deprecated: qty) or amount+unit.",
  );

function assertBasketItems(items: z.infer<typeof basketItemsSchema>): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!item.product_id && !item.gtin && !item.query) {
      throw new AppError("bad_request", `items[${i}] requires product_id, gtin, or query`, 400);
    }
    if (item.pack_qty == null && item.qty == null && item.amount == null) {
      throw new AppError("bad_request", `items[${i}] requires pack_qty or amount`, 400);
    }
    if (item.pack_qty != null && item.qty != null) {
      throw new AppError(
        "bad_request",
        `items[${i}] cannot supply both pack_qty and deprecated qty`,
        400,
      );
    }
    if (item.amount != null && !(item.unit && item.unit.trim())) {
      throw new AppError(
        "bad_request",
        `items[${i}] amount requires unit (kg, g, L, ml, unit, יח, …)`,
        400,
      );
    }
  }
}

function mapBasketItems(items: z.infer<typeof basketItemsSchema>) {
  return items.map((item) => ({
    productId: item.product_id,
    gtin: item.gtin,
    query: item.query,
    qty: item.pack_qty ?? item.qty,
    amount: item.amount,
    unit: item.unit,
  }));
}

export function registerBasketTools(server: McpServer): void {
  registerTool(
    server,
    "prepare_basket",
    {
      title: "Resolve a shopping list near a location",
      description:
        "FIRST step for shopping lists: resolve free-text lines to product candidates near city/near " +
        "(default radius). Returns resolutionStatus, safe assumptions, and required questions with at most " +
        "three compact product/pack options for needs_confirmation lines. Each option carries " +
        "nearbyPricedStores (real count of location-scoped stores that price it) and hasLocalPrice " +
        "(nearbyPricedStores > 0). Does not load basket prices. " +
        "After the user answers every required question, call optimize_basket with product_id for confirmed lines.",
      inputSchema: {
        items: basketItemsSchema,
        ...locationShape,
      },
    },
    async ({ items, city, near, radius_km }) => {
      assertBasketItems(items);
      const geo = toGeo(near);
      return prepareBasket({
        items: mapBasketItems(items),
        city,
        near: geo,
        radiusKm: resolveRadiusKm(geo, radius_km),
      });
    },
  );

  registerTool(
    server,
    "optimize_basket",
    {
      title: "Price a basket at nearby stores in one shot",
      description:
        "One-shot: prices the safely-resolved lines immediately and returns any lines that still need " +
        "confirmation as `questions` (same shape as prepare_basket) — no separate prepare call required. " +
        "Totals cover the resolved subset (see completeness.totalsArePartial); re-call with `product_id` " +
        "answers to the questions to finalize. Returns `recommendations` with cheapest (lowest total) and " +
        "bestNearby (most items covered, ties broken by total + distance — the store you'd actually go to), " +
        "multiStore (cheapest-per-item), " +
        `top stores (default 5), and questions. Requires city and/or near (default ${DEFAULT_RADIUS_KM}km). ` +
        "By default (verbose=false) per-store `lines` are included only for the recommended stores to keep the " +
        "response small (missingItems is always kept); set verbose=true for full per-store line detail. " +
        "Missing items are listed — never silently dropped. Every priced line carries a `link` to open that " +
        "product on the chain's online store.",
      inputSchema: {
        items: basketItemsSchema,
        ...locationShape,
        include_club: z
          .boolean()
          .optional()
          .describe("Whether to apply club-member-only promotions. Defaults to true."),
        stores_limit: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe("Max store breakdowns to return (default 5). 0 = all compared stores."),
        distance_penalty_per_km: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "Shekels of 'cost' per km when ranking recommendations.bestNearby (default 3). Higher favors closer stores when coverage ties.",
          ),
        verbose: z
          .boolean()
          .optional()
          .describe(
            "Default false. When false, per-store `lines` are returned only for the recommended stores (missingItems always kept); set true for full per-store line detail.",
          ),
      },
    },
    async ({
      items,
      city,
      near,
      radius_km,
      include_club,
      stores_limit,
      distance_penalty_per_km,
      verbose,
    }) => {
      assertBasketItems(items);
      const geo = toGeo(near);
      return optimizeBasket({
        items: mapBasketItems(items),
        city,
        near: geo,
        radiusKm: resolveRadiusKm(geo, radius_km),
        includeClub: include_club,
        storesLimit: stores_limit,
        distancePenaltyPerKm: distance_penalty_per_km,
        verbose,
      });
    },
  );
}
