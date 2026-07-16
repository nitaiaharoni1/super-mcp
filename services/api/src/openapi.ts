/** Static OpenAPI 3 document served at GET /openapi.json. Hand-written to match the routes exactly. */

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
    },
  },
};

const freshnessSchema = {
  type: "object",
  properties: {
    sourceTs: { type: "string", format: "date-time", description: "When the chain published this price." },
    ingestedAt: { type: "string", format: "date-time", description: "When this service last ingested it." },
  },
};

const productSchema = {
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

const listingSchema = {
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

const chainSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    sourceId: { type: "string" },
    market: { type: "string" },
    nameHe: { type: "string" },
    nameEn: { type: "string", nullable: true },
    currency: { type: "string" },
  },
};

const storeSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    chainId: { type: "string" },
    chainName: { type: "string" },
    storeCode: { type: "string" },
    name: { type: "string" },
    address: { type: "string", nullable: true },
    city: { type: "string", nullable: true },
    zip: { type: "string", nullable: true },
    lat: { type: "number", nullable: true },
    lng: { type: "number", nullable: true },
    distanceKm: { type: "number", nullable: true },
  },
};

const priceRowSchema = {
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
    freshness: freshnessSchema,
  },
};

const promotionSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    chainId: { type: "string" },
    chainName: { type: "string" },
    storeId: { type: "string", format: "uuid", nullable: true },
    storeCode: { type: "string", nullable: true },
    promoCode: { type: "string" },
    description: { type: "string" },
    mechanicType: {
      type: "string",
      enum: ["simple_discount", "n_for_price", "second_unit_pct", "club_price", "spend_threshold", "other"],
    },
    mechanicParams: { type: "object" },
    clubOnly: { type: "boolean" },
    startTs: { type: "string", format: "date-time" },
    endTs: { type: "string", format: "date-time" },
    sourceTs: { type: "string", format: "date-time" },
    ingestedAt: { type: "string", format: "date-time" },
    itemCodes: { type: "array", items: { type: "string" } },
  },
};

const basketItemInputSchema = {
  type: "object",
  required: ["qty"],
  properties: {
    product_id: { type: "string", format: "uuid" },
    gtin: { type: "string" },
    query: { type: "string" },
    qty: { type: "number", minimum: 0, exclusiveMinimum: true },
  },
  description: "Exactly one of product_id, gtin, or query should be set.",
};

const basketOptimizeRequestSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: basketItemInputSchema, minItems: 1, maxItems: 50 },
    city: { type: "string" },
    near: { type: "string", description: "'lat,lng', e.g. '32.078,34.774'." },
    radius_km: { type: "number", default: 10, description: "Default 10km when 'near' is set." },
    include_club: { type: "boolean", default: true },
  },
};

const basketLineSchema = {
  type: "object",
  properties: {
    itemIndex: { type: "integer" },
    productId: { type: "string", format: "uuid" },
    name: { type: "string" },
    qty: { type: "number" },
    listingId: { type: "string", format: "uuid" },
    itemCode: { type: "string" },
    unitPrice: { type: "number" },
    lineTotal: { type: "number" },
    promoApplied: { type: "boolean" },
    promoDescription: { type: "string", nullable: true },
    freshness: freshnessSchema,
  },
};

const basketMissingItemSchema = {
  type: "object",
  properties: {
    itemIndex: { type: "integer" },
    productId: { type: "string", format: "uuid", nullable: true },
    name: { type: "string", nullable: true },
    reason: { type: "string", enum: ["product_not_found", "not_carried_by_chain", "no_price_data"] },
  },
};

const basketOptimizeResponseSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          qty: { type: "number" },
          productId: { type: "string", format: "uuid", nullable: true },
          name: { type: "string", nullable: true },
          resolved: { type: "boolean" },
          resolvedBy: { type: "string", enum: ["product_id", "gtin", "query", "unresolved"] },
        },
      },
    },
    stores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          storeId: { type: "string", format: "uuid" },
          storeName: { type: "string" },
          chainId: { type: "string" },
          chainName: { type: "string" },
          city: { type: "string", nullable: true },
          address: { type: "string", nullable: true },
          distanceKm: { type: "number", nullable: true },
          currency: { type: "string" },
          total: { type: "number" },
          itemsFound: { type: "integer" },
          itemsRequested: { type: "integer" },
          lines: { type: "array", items: basketLineSchema },
          missingItems: { type: "array", items: basketMissingItemSchema },
        },
      },
    },
    cheapest: {
      type: "object",
      nullable: true,
      description: "Recommended cheapest nearby store for this basket (same as stores[0] when present).",
      properties: {
        storeId: { type: "string", format: "uuid" },
        storeName: { type: "string" },
        chainId: { type: "string" },
        chainName: { type: "string" },
        total: { type: "number" },
        currency: { type: "string" },
        itemsFound: { type: "integer" },
        itemsRequested: { type: "integer" },
        distanceKm: { type: "number", nullable: true },
        reason: { type: "string" },
      },
    },
  },
};

const apiKeyHeader = {
  BearerAuth: {
    type: "http",
    scheme: "bearer",
    description: "sha256-hashed and matched against api_key.key_hash.",
  },
};

function withData(schema: unknown): { type: "object"; properties: { data: unknown } } {
  return { type: "object", properties: { data: schema } };
}

const errorResponses = {
  "400": { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
  "401": { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  "404": { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  "429": { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
};

export function getOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "super-mcp API",
      version: "0.1.0",
      description:
        "Canonical Israeli supermarket product, price, and promotion data. REST API + remote MCP server " +
        "(mounted at /mcp) share the same service layer and API-key auth.",
    },
    servers: [{ url: "/" }],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: apiKeyHeader,
      schemas: {
        Error: errorSchema,
        Product: productSchema,
        ProductListing: listingSchema,
        Chain: chainSchema,
        Store: storeSchema,
        PriceRow: priceRowSchema,
        Promotion: promotionSchema,
        BasketOptimizeRequest: basketOptimizeRequestSchema,
        BasketOptimizeResponse: basketOptimizeResponseSchema,
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, time: { type: "string" } } } } },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI document",
          security: [],
          responses: { "200": { description: "OK" } },
        },
      },
      "/v1/products": {
        get: {
          summary: "Search products (Hebrew/English)",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "brand", in: "query", schema: { type: "string" } },
            { name: "gtin", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
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
      "/v1/chains": {
        get: {
          summary: "List chains",
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: withData({ type: "array", items: chainSchema }) } } },
            ...errorResponses,
          },
        },
      },
      "/v1/stores": {
        get: {
          summary: "List stores",
          parameters: [
            { name: "chain", in: "query", schema: { type: "string" } },
            { name: "city", in: "query", schema: { type: "string" } },
            { name: "near", in: "query", schema: { type: "string" }, description: "'lat,lng'" },
            { name: "radius_km", in: "query", schema: { type: "number", default: 10 } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: withData({ type: "array", items: storeSchema }) } } },
            ...errorResponses,
          },
        },
      },
      "/v1/promotions": {
        get: {
          summary: "List promotions",
          parameters: [
            { name: "store_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "product_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "active", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: withData({ type: "array", items: promotionSchema }) } } },
            ...errorResponses,
          },
        },
      },
      "/v1/basket/optimize": {
        post: {
          summary: "Find the cheapest basket nearby (default 10km)",
          description: "Requires 'city' or 'near'. Returns ranked stores plus a 'cheapest' recommendation.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: basketOptimizeRequestSchema } },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: withData(basketOptimizeResponseSchema) } } },
            ...errorResponses,
          },
        },
      },
      "/v1/usage": {
        get: {
          summary: "Usage summary for the caller's API key",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: withData({
                    type: "object",
                    properties: {
                      apiKey: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, rateLimitPerMinute: { type: "integer" } } },
                      totalRequests: { type: "integer" },
                      requestsLast24h: { type: "integer" },
                      requestsLastMinute: { type: "integer" },
                      byRoute: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            route: { type: "string" },
                            count: { type: "integer" },
                            avgLatencyMs: { type: "number", nullable: true },
                            lastUsed: { type: "string", format: "date-time" },
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
      "/mcp": {
        post: {
          summary: "MCP Streamable HTTP endpoint (JSON-RPC 2.0)",
          description:
            "Remote MCP server exposing search_products, get_product, compare_prices, optimize_basket, " +
            "list_stores, get_promotions. Accepts the same Bearer key, or ?api_key= for clients that can't set headers.",
          responses: { "200": { description: "JSON-RPC response or SSE stream" } },
        },
      },
    },
  };
}
