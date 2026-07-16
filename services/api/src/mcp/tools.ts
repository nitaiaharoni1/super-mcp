import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import { getProductById, getProductPrices, searchProducts } from "../services/products.js";
import { listStores } from "../services/stores.js";
import { listPromotions } from "../services/promotions.js";
import { optimizeBasket } from "../services/basket.js";
import { suggestSubstitutes } from "../services/substitutes.js";
import { parseNear, type GeoPoint } from "../lib/geo.js";
import { DEFAULT_RADIUS_KM, resolveRadiusKm } from "../lib/defaults.js";

/** Shared location filter fields, reused across tools that scope results to a place. */
const locationShape = {
  city: z
    .string()
    .optional()
    .describe("City name (Hebrew or English) to filter stores, e.g. 'תל אביב' or 'Tel Aviv'. Exact match."),
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

function toGeo(near: string | undefined): GeoPoint | undefined {
  return parseNear(near);
}

function textResult(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  // Mirror REST: only AppError messages are safe for clients; never leak pg/SQL text.
  const message = err instanceof AppError ? err.message : "Internal server error";
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

async function resolveProductId(productId: string | undefined, gtin: string | undefined): Promise<string | null> {
  if (productId) return productId;
  if (gtin) {
    const rows = await searchProducts({ q: "", gtin, limit: 1 });
    return rows[0]?.id ?? null;
  }
  return null;
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Search the canonical product catalog by free text (Hebrew or English), brand, category, or exact GTIN " +
        "barcode. Use this first when the user names a product loosely (e.g. 'milk' or 'חלב תנובה') to find its " +
        "product_id before calling compare_prices, suggest_substitutes, or optimize_basket. Returns canonical " +
        "products, not per-chain listings — call get_product for per-chain detail.",
      inputSchema: {
        query: z.string().optional().describe("Free text search, Hebrew or English, e.g. 'חלב תנובה' or 'olive oil'."),
        category: z.string().optional().describe("Filter by internal category slug (l1 or l2), e.g. 'dairy'."),
        brand: z.string().optional().describe("Filter by brand name, partial match."),
        gtin: z.string().optional().describe("Exact GTIN/barcode to look up."),
        limit: z.number().int().min(1).max(100).optional().describe("Max results, default 20."),
      },
    },
    async ({ query, category, brand, gtin, limit }) => {
      try {
        const products = await searchProducts({ q: query ?? "", category, brand, gtin, limit: limit ?? 20 });
        return textResult({ products });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description:
        "Fetch full detail for one canonical product by product_id (UUID) or GTIN barcode, including every " +
        "per-chain listing (chain-specific item code, display name, and package size). Use after search_products " +
        "to confirm identity, or directly when the GTIN is already known.",
      inputSchema: {
        product_id: z.string().uuid().optional().describe("Canonical product UUID."),
        gtin: z.string().optional().describe("GTIN/barcode, used only if product_id is omitted."),
      },
    },
    async ({ product_id, gtin }) => {
      try {
        const id = await resolveProductId(product_id, gtin);
        if (!id) return errorResult(new AppError("not_found", "Product not found", 404));
        const product = await getProductById(id);
        if (!product) return errorResult(new AppError("not_found", "Product not found", 404));
        return textResult({ product });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "compare_prices",
    {
      title: "Compare prices across chains and branches",
      description:
        "Compare one product's current price across chains and store branches within a city or near a point " +
        `(default ${DEFAULT_RADIUS_KM}km). Results are sorted cheapest-first. Use sort='unit_price' to rank by ` +
        "₪ per 100g / 100ml / unit (\"cheaper per 100g\") instead of pack price. Every price carries freshness: " +
        "source_ts and ingested_at — treat source_ts older than ~48h as possibly stale. Active promotions are " +
        "applied to effective_price; list_price is the unpromoted shelf price.",
      inputSchema: {
        product_id: z.string().uuid().optional().describe("Canonical product UUID, from search_products or get_product."),
        gtin: z.string().optional().describe("GTIN/barcode, used only if product_id is omitted."),
        ...locationShape,
        sort: z
          .enum(["price", "unit_price"])
          .optional()
          .describe(
            "price = cheapest pack/effective total (default). unit_price = cheapest per 100g/100ml/unit.",
          ),
        include_club: z
          .boolean()
          .optional()
          .describe("Whether to apply club-member-only promotions to effective_price. Defaults to true."),
      },
    },
    async ({ product_id, gtin, city, near, radius_km, sort, include_club }) => {
      try {
        const id = await resolveProductId(product_id, gtin);
        if (!id) return errorResult(new AppError("not_found", "Product not found", 404));
        const geo = toGeo(near);
        const prices = await getProductPrices(id, {
          city,
          near: geo,
          radiusKm: resolveRadiusKm(geo, radius_km),
          includeClub: include_club,
          sortBy: sort,
        });
        return textResult({ product_id: id, sort: sort ?? "price", radius_km: resolveRadiusKm(geo, radius_km), prices });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "suggest_substitutes",
    {
      title: "Suggest cheaper similar products",
      description:
        "Given a product, suggest similar alternatives (same category and/or similar name) that are cheaper " +
        "per 100g / 100ml / unit in nearby stores (default 10km when 'near' is set). Use when the user asks " +
        "for a cheaper brand, private-label alternative, or \"cheaper per 100g\". Returns baseline unit price " +
        "plus ranked substitutes with savings.",
      inputSchema: {
        product_id: z.string().uuid().optional().describe("Canonical product UUID."),
        gtin: z.string().optional().describe("GTIN/barcode, used only if product_id is omitted."),
        ...locationShape,
        limit: z.number().int().min(1).max(50).optional().describe("Max substitutes, default 10."),
        cheaper_only: z
          .boolean()
          .optional()
          .describe("If true (default), only return substitutes with lower unit price than the baseline."),
      },
    },
    async ({ product_id, gtin, city, near, radius_km, limit, cheaper_only }) => {
      try {
        const id = await resolveProductId(product_id, gtin);
        if (!id) return errorResult(new AppError("not_found", "Product not found", 404));
        const geo = toGeo(near);
        const result = await suggestSubstitutes(id, {
          city,
          near: geo,
          radiusKm: resolveRadiusKm(geo, radius_km),
          limit,
          cheaperOnly: cheaper_only,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "optimize_basket",
    {
      title: "Find the cheapest basket nearby",
      description:
        "Given a shopping list (each item identified by product_id, gtin, or a free-text query, plus qty), compute " +
        "the total cost per candidate store with active promotions applied, ranked cheapest and most-complete " +
        `first within city or near+radius (default ${DEFAULT_RADIUS_KM}km). Response includes 'cheapest' — the ` +
        "recommended store — plus full per-store breakdowns. Items a store doesn't carry are listed under " +
        "missing_items — never silently dropped. Requires city and/or near.",
      inputSchema: {
        items: z
          .array(
            z.object({
              product_id: z.string().uuid().optional().describe("Canonical product UUID, if known."),
              gtin: z.string().optional().describe("GTIN/barcode, if known."),
              query: z.string().optional().describe("Free-text product name, used if product_id/gtin are unknown."),
              qty: z.number().positive().describe("Quantity of this item to buy."),
            }),
          )
          .min(1)
          .max(50)
          .describe("Shopping list. Each item needs exactly one of product_id, gtin, or query."),
        ...locationShape,
        include_club: z
          .boolean()
          .optional()
          .describe("Whether to apply club-member-only promotions. Defaults to true."),
      },
    },
    async ({ items, city, near, radius_km, include_club }) => {
      try {
        const geo = toGeo(near);
        const result = await optimizeBasket({
          items: items.map((item) => ({
            productId: item.product_id,
            gtin: item.gtin,
            query: item.query,
            qty: item.qty,
          })),
          city,
          near: geo,
          radiusKm: resolveRadiusKm(geo, radius_km),
          includeClub: include_club,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_stores",
    {
      title: "List store branches",
      description:
        "List physical store branches, optionally filtered by chain id, city, or near a point + radius_km " +
        `(default ${DEFAULT_RADIUS_KM}km). Use to discover which branches exist in an area before scoping ` +
        "compare_prices/optimize_basket.",
      inputSchema: {
        chain: z.string().optional().describe("Chain id (the chain's legal barcode id) to filter by."),
        ...locationShape,
      },
    },
    async ({ chain, city, near, radius_km }) => {
      try {
        const geo = toGeo(near);
        const stores = await listStores({
          chain,
          city,
          near: geo,
          radiusKm: resolveRadiusKm(geo, radius_km),
        });
        return textResult({ stores });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_promotions",
    {
      title: "Get promotions",
      description:
        "List promotions (e.g. '2 for 30₪', club-member price, second-unit discount), optionally filtered by " +
        "store_id or product_id, and by active=true to only return promotions currently running. Use this to " +
        "explain why a compare_prices or optimize_basket effective_price is lower than list_price.",
      inputSchema: {
        store_id: z.string().uuid().optional().describe("Filter to promotions at this store."),
        product_id: z.string().uuid().optional().describe("Filter to promotions covering this canonical product."),
        active: z.boolean().optional().describe("If true, only currently-active promotions. Defaults to true."),
      },
    },
    async ({ store_id, product_id, active }) => {
      try {
        const promotions = await listPromotions({
          storeId: store_id,
          productId: product_id,
          activeOnly: active ?? true,
        });
        return textResult({ promotions });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
