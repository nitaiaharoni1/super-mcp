import { errorResponses, freshnessSchema, withData } from "./common.js";

export const productSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    gtin: { type: "string", nullable: true },
    name: { type: "string" },
    brand: { type: "string", nullable: true },
    categoryL1: { type: "string", nullable: true },
    categoryL2: { type: "string", nullable: true },
    sizeQty: { type: "number", nullable: true },
    sizeUnit: { type: "string", nullable: true },
  },
};

export const listingSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    chainId: { type: "string" },
    chainName: { type: "string" },
    itemCode: { type: "string" },
    name: { type: "string" },
    brand: { type: "string", nullable: true },
    qty: { type: "number", nullable: true },
    unit: { type: "string", nullable: true },
    canonicalQty: { type: "number", nullable: true },
    canonicalUnit: { type: "string", nullable: true },
    measureUnparseable: { type: "boolean" },
  },
};

export const priceRowSchema = {
  type: "object",
  properties: {
    storeId: { type: "string", format: "uuid" },
    storeName: { type: "string" },
    chainId: { type: "string" },
    chainName: { type: "string" },
    city: { type: "string", nullable: true },
    address: { type: "string", nullable: true },
    lat: { type: "number", nullable: true },
    lng: { type: "number", nullable: true },
    distanceKm: { type: "number", nullable: true },
    listingId: { type: "string", format: "uuid" },
    itemCode: { type: "string" },
    listPrice: { type: "number" },
    unitPrice: {
      type: "number",
      nullable: true,
      description: "₪ per 100g, 100ml, or per unit (cheaper-per-100g comparison).",
    },
    unitBasis: { type: "string", enum: ["per_100g", "per_100ml", "per_unit", "unknown"] },
    currency: { type: "string" },
    effectivePrice: { type: "number", description: "listPrice with any applicable active promo applied." },
    promoApplied: { type: "boolean" },
    promoDescription: { type: "string", nullable: true },
    link: {
      type: "string",
      nullable: true,
      description:
        "Clickable storefront URL to open this product on the chain's site (search-by-barcode, or by name for chains that don't index barcodes). Null when the chain has no online store.",
    },
    freshness: freshnessSchema,
  },
};

export const productComponentSchemas = {
  Product: productSchema,
  ProductListing: listingSchema,
  PriceRow: priceRowSchema,
};

export const productPaths = {
  "/v1/products": {
    get: {
      summary: "Search products (Hebrew/English)",
      parameters: [
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "category", in: "query", schema: { type: "string" } },
        { name: "brand", in: "query", schema: { type: "string" } },
        { name: "gtin", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        { name: "city", in: "query", schema: { type: "string" }, description: "Prefer products priced in this city" },
        { name: "near", in: "query", schema: { type: "string" }, description: "lat,lng — prefer products priced nearby" },
        { name: "radius_km", in: "query", schema: { type: "number", default: 10 } },
        { name: "store_id", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "in_stock_only", in: "query", schema: { type: "boolean", default: false } },
      ],
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: withData({ type: "array", items: productSchema }) } } },
        ...errorResponses,
      },
    },
  },
  "/v1/products/{id}": {
    get: {
      summary: "Get canonical product + per-chain listings",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: withData({ allOf: [productSchema, { type: "object", properties: { listings: { type: "array", items: listingSchema } } }] }) } },
        },
        ...errorResponses,
      },
    },
  },
  "/v1/products/{id}/prices": {
    get: {
      summary: "Compare prices nearby (default 10km), promos applied",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "city", in: "query", schema: { type: "string" } },
        { name: "near", in: "query", schema: { type: "string" }, description: "'lat,lng'" },
        { name: "radius_km", in: "query", schema: { type: "number", default: 10 } },
        {
          name: "sort",
          in: "query",
          schema: { type: "string", enum: ["price", "unit_price"], default: "price" },
          description: "price = pack total; unit_price = cheaper per 100g/100ml/unit",
        },
        { name: "include_club", in: "query", schema: { type: "boolean", default: true } },
      ],
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: withData({ type: "array", items: priceRowSchema }) } } },
        ...errorResponses,
      },
    },
  },
  "/v1/products/{id}/substitutes": {
    get: {
      summary: "Suggest cheaper similar products (by unit price)",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "city", in: "query", schema: { type: "string" } },
        { name: "near", in: "query", schema: { type: "string" }, description: "'lat,lng'" },
        { name: "radius_km", in: "query", schema: { type: "number", default: 10 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 10, maximum: 50 } },
        { name: "cheaper_only", in: "query", schema: { type: "boolean", default: true } },
      ],
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: withData({
                type: "object",
                properties: {
                  product: productSchema,
                  baseline: {
                    type: "object",
                    properties: {
                      bestUnitPrice: { type: "number", nullable: true },
                      unitBasis: {
                        type: "string",
                        enum: ["per_100g", "per_100ml", "per_unit", "unknown"],
                      },
                      currency: { type: "string" },
                      storeId: { type: "string", format: "uuid", nullable: true },
                      storeName: { type: "string", nullable: true },
                    },
                  },
                  substitutes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        product: productSchema,
                        bestUnitPrice: { type: "number" },
                        unitBasis: {
                          type: "string",
                          enum: ["per_100g", "per_100ml", "per_unit", "unknown"],
                        },
                        currency: { type: "string" },
                        storeId: { type: "string", format: "uuid" },
                        storeName: { type: "string" },
                        chainId: { type: "string" },
                        chainName: { type: "string" },
                        distanceKm: { type: "number", nullable: true },
                        unitPriceSaving: { type: "number", nullable: true },
                        matchReason: {
                          type: "string",
                          enum: ["same_category", "similar_name", "same_category_and_name"],
                        },
                      },
                    },
                  },
                },
              }),
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  "/v1/products/{id}/history": {
    get: {
      summary: "Price history for a product",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "store_id", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
        { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
      ],
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: withData({
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    storeId: { type: "string", format: "uuid" },
                    storeName: { type: "string" },
                    chainId: { type: "string" },
                    price: { type: "number" },
                    unitPrice: { type: "number", nullable: true },
                    currency: { type: "string" },
                    sourceTs: { type: "string", format: "date-time" },
                  },
                },
              }),
            },
          },
        },
        ...errorResponses,
      },
    },
  },
};

/** MCP tools backed by the products service layer. */
export const productMcpTools = [
  "search_products",
  "get_product",
  "compare_prices",
  "suggest_substitutes",
  "resolve_products",
] as const;
