import { errorResponses, freshnessSchema, withData } from "./common.js";
import { storeLocationMetadataSchema } from "./stores.js";

export const basketItemInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    product_id: { type: "string", format: "uuid" },
    gtin: { type: "string", minLength: 1 },
    query: { type: "string", minLength: 1 },
    pack_qty: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Number of product packs to buy. Mutually exclusive with amount.",
    },
    amount: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Physical amount (requires unit), e.g. 1.5 with unit=kg.",
    },
    unit: {
      type: "string",
      minLength: 1,
      description: "Required with amount: kg, g, L, ml, unit, יח, etc.",
    },
  },
  description:
    "Exactly one of product_id, gtin, or query; and exactly one of pack_qty or amount+unit.",
};

const basketLocationRequestProperties = {
  city: {
    type: "string",
    description:
      "Hebrew or English city (or CBS locality code). Aliases match one place — e.g. הרצליה / Herzliya / 6400.",
  },
  near: { type: "string", description: "'lat,lng', e.g. '32.078,34.774'." },
  radius_km: { type: "number", default: 10, description: "Default 10km when 'near' is set." },
};

export const basketInitialRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: basketItemInputSchema, minItems: 1, maxItems: 50 },
    ...basketLocationRequestProperties,
    include_club: { type: "boolean", default: true },
    stores_limit: {
      type: "integer",
      minimum: 0,
      maximum: 500,
      description: "Max store breakdowns (default 5). 0 = all.",
    },
    distance_penalty_per_km: {
      type: "number",
      minimum: 0,
      maximum: 100,
      default: 3,
      description: "Shekels of cost per km when ranking bestSingleStore (default 3).",
    },
    verbose: {
      type: "boolean",
      default: false,
      description:
        "When false, per-store lines are returned only for recommended stores; missingItems always kept.",
    },
  },
};

export const basketResumeRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["continuation", "answers"],
  properties: {
    continuation: {
      type: "string",
      minLength: 1,
      description: "Opaque signed token from a prior needs_confirmation response.",
    },
    answers: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_index", "product_id"],
        properties: {
          item_index: { type: "integer", minimum: 0 },
          product_id: { type: "string", format: "uuid" },
        },
      },
    },
  },
};

export const basketOptimizeRequestSchema = {
  oneOf: [basketInitialRequestSchema, basketResumeRequestSchema],
};

const basketCoverageSchema = {
  type: "object",
  required: ["pricedLines", "resolvableLines", "requestedLines", "coverageRatio"],
  properties: {
    pricedLines: { type: "integer" },
    resolvableLines: { type: "integer" },
    requestedLines: { type: "integer" },
    coverageRatio: { type: "number" },
  },
};

const basketLineSchema = {
  type: "object",
  properties: {
    itemIndex: { type: "integer" },
    productId: { type: "string", format: "uuid" },
    name: { type: "string" },
    qty: { type: "number" },
    qtyMode: {
      type: "string",
      enum: ["packs", "weighted_kg_or_l", "units"],
    },
    listingId: { type: "string", format: "uuid" },
    itemCode: { type: "string" },
    unitPrice: { type: "number" },
    lineTotal: { type: "number" },
    promoApplied: { type: "boolean" },
    promoDescription: { type: "string", nullable: true },
    substituted: { type: "boolean" },
    substitutionReason: { type: "string", nullable: true },
    originalProductId: { type: "string", format: "uuid", nullable: true },
    link: { type: "string", nullable: true },
    freshness: freshnessSchema,
  },
};

const basketStorePlanSchema = {
  allOf: [
    basketCoverageSchema,
    {
      type: "object",
      required: ["storeId", "storeName", "chainId", "chainName", "total", "currency", "lines", "missingItems"],
      properties: {
        storeId: { type: "string", format: "uuid" },
        storeName: { type: "string" },
        chainId: { type: "string", format: "uuid" },
        chainName: { type: "string" },
        total: { type: "number" },
        currency: { type: "string" },
        distanceKm: { type: "number", nullable: true },
        lines: { type: "array", items: basketLineSchema },
        missingItems: { type: "array", items: { type: "object" } },
      },
    },
  ],
};

const basketQuestionSchema = {
  type: "object",
  required: ["itemIndex", "id", "prompt", "reason", "required", "selectionEffect", "options"],
  properties: {
    itemIndex: { type: "integer" },
    id: { type: "string" },
    prompt: { type: "string" },
    reason: { type: "string" },
    required: { type: "boolean", enum: [true] },
    selectionEffect: { type: "string", enum: ["representative", "pin"] },
    options: {
      type: "array",
      items: {
        type: "object",
        required: [
          "productId",
          "name",
          "pack",
          "nearbyPricedStores",
          "nearbyPricedChains",
          "minimumNearbyPrice",
        ],
        properties: {
          productId: { type: "string", format: "uuid" },
          name: { type: "string" },
          pack: {
            type: "object",
            properties: {
              pieceCount: { type: "integer", nullable: true },
              sizeQty: { type: "number", nullable: true },
              sizeUnit: { type: "string", nullable: true },
            },
          },
          nearbyPricedStores: { type: "integer" },
          nearbyPricedChains: { type: "integer" },
          minimumNearbyPrice: { type: "number", nullable: true },
        },
      },
    },
  },
};

export const basketNeedsConfirmationResponseSchema = {
  type: "object",
  required: ["status", "continuation", "questions", "preview", "items", "location"],
  properties: {
    status: { type: "string", enum: ["needs_confirmation"] },
    continuation: { type: "string" },
    questions: { type: "array", items: basketQuestionSchema },
    preview: {
      type: "object",
      required: ["priceScope", "resolvedLines", "requestedLines", "candidateStores"],
      properties: {
        priceScope: { type: "string", enum: ["resolved_subset"] },
        resolvedLines: { type: "integer" },
        requestedLines: { type: "integer" },
        candidateStores: { type: "integer" },
      },
    },
    items: { type: "array", items: { type: "object" } },
    location: storeLocationMetadataSchema,
  },
};

export const basketCompleteResponseSchema = {
  type: "object",
  required: [
    "status",
    "bestSingleStore",
    "cheapestCompleteStore",
    "multiStore",
    "items",
    "stores",
    "storesCompared",
    "storesTruncated",
    "location",
  ],
  properties: {
    status: { type: "string", enum: ["complete"] },
    bestSingleStore: { oneOf: [basketStorePlanSchema, { type: "null" }] },
    cheapestCompleteStore: { oneOf: [basketStorePlanSchema, { type: "null" }] },
    multiStore: {
      oneOf: [
        {
          allOf: [
            basketCoverageSchema,
            {
              type: "object",
              properties: {
                total: { type: "number" },
                currency: { type: "string" },
                storeCount: { type: "integer" },
                lines: { type: "array", items: { type: "object" } },
                missingItemIndexes: { type: "array", items: { type: "integer" } },
              },
            },
          ],
        },
        { type: "null" },
      ],
    },
    items: { type: "array", items: { type: "object" } },
    stores: { type: "array", items: { type: "object" } },
    storesCompared: { type: "integer" },
    storesTruncated: { type: "boolean" },
    location: storeLocationMetadataSchema,
  },
};

export const basketOptimizeResponseSchema = {
  oneOf: [basketNeedsConfirmationResponseSchema, basketCompleteResponseSchema],
  discriminator: { propertyName: "status" },
};

export const basketComponentSchemas = {
  BasketOptimizeRequest: basketOptimizeRequestSchema,
  BasketOptimizeResponse: basketOptimizeResponseSchema,
  BasketInitialRequest: basketInitialRequestSchema,
  BasketResumeRequest: basketResumeRequestSchema,
  BasketNeedsConfirmationResponse: basketNeedsConfirmationResponseSchema,
  BasketCompleteResponse: basketCompleteResponseSchema,
};

export const basketPaths = {
  "/v1/basket/optimize": {
    post: {
      summary: "Resolve and price a shopping basket (resumable)",
      description:
        "Call once with the original shopping list (city or near required). If status is " +
        "needs_confirmation, ask every returned question and call again with only continuation and " +
        "answers. If status is complete, use bestSingleStore, cheapestCompleteStore, and multiStore. " +
        "Never reconstruct items and do not call search_products per line.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: basketOptimizeRequestSchema } },
      },
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: withData(basketOptimizeResponseSchema) } },
        },
        ...errorResponses,
      },
    },
  },
};

/** MCP tools backed by the basket service layer. */
export const basketMcpTools = ["optimize_basket"] as const;
