import { errorResponses, withData } from "./common.js";

export const chainSchema = {
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

export const storeSchema = {
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
    geoSource: {
      type: "string",
      nullable: true,
      description: "Provenance of lat/lng: address, feed, city_centroid, or null.",
    },
    distanceKm: { type: "number", nullable: true },
  },
};

export const storeLocationMetadataSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["unscoped", "city", "near", "city_near"] },
    precision: { type: "string", enum: ["none", "city", "radius"] },
    fallbackApplied: { type: "boolean" },
    warning: { type: "string", nullable: true },
    distanceReliable: {
      type: "boolean",
      description:
        "False when near-scope results only have city_centroid (or identically shared) coordinates; " +
        "distance ranking is suppressed. True when near was not requested or at least one store has address/feed geo.",
    },
    requested: {
      type: "object",
      properties: {
        city: { type: "string", nullable: true },
        near: {
          type: "object",
          nullable: true,
          properties: { lat: { type: "number" }, lng: { type: "number" } },
        },
        radiusKm: { type: "number", nullable: true },
      },
    },
  },
};

export const promotionSchema = {
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

export const storeComponentSchemas = {
  Chain: chainSchema,
  Store: storeSchema,
  StoreLocationMetadata: storeLocationMetadataSchema,
  Promotion: promotionSchema,
};

export const storePaths = {
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
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: withData({
                type: "object",
                properties: {
                  stores: { type: "array", items: storeSchema },
                  location: storeLocationMetadataSchema,
                },
              }),
            },
          },
        },
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
};

/** MCP tools backed by the stores/promotions service layer. */
export const storeMcpTools = ["list_stores", "get_promotions"] as const;
