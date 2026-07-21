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
      "Hebrew or English city (or CBS locality code). Aliases match one place — e.g. הרצליה / Herzliya / 6400. " +
      "May be combined with location as a disambiguation hint / store filter.",
  },
  near: { type: "string", description: "'lat,lng', e.g. '32.078,34.774'. Do not combine with location." },
  location: {
    type: "string",
    minLength: 3,
    maxLength: 300,
    description:
      "Free-text neighborhood or address in Israel, e.g. 'נווה עמל, הרצליה'. Resolved to coordinates via " +
      "cached Nominatim. Do not combine with near.",
  },
  radius_km: {
    type: "number",
    default: 10,
    description: "Default 10km when near or location resolves to a point.",
  },
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
        "Deprecated. Prefer response_detail. When response_detail is absent, verbose=true maps to debug; otherwise ignored.",
    },
    resolution_mode: {
      type: "string",
      enum: ["fast", "strict"],
      default: "fast",
      description:
        "fast returns a best-effort priced basket in one call; strict pauses for material ambiguity.",
    },
    response_detail: {
      type: "string",
      enum: ["summary", "standard", "debug"],
      default: "summary",
      description:
        "Controls response size. summary (default) returns compact recommendations + coverage; " +
        "standard adds item statuses and store breakdowns; debug adds candidates, all store lines, and phase timings. " +
        "Precedence: response_detail if supplied, else verbose=true → debug, else summary.",
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

const basketTotalScopeSchema = {
  type: "string",
  enum: ["complete_basket", "priced_lines_only"],
  description:
    "complete_basket when every requested line is priced; priced_lines_only when total " +
    "covers only the priced subset (not the full basket).",
};

const basketStorePlanSchema = {
  allOf: [
    basketCoverageSchema,
    {
      type: "object",
      required: [
        "storeId",
        "storeName",
        "chainId",
        "chainName",
        "total",
        "totalScope",
        "currency",
        "lines",
        "missingItems",
      ],
      properties: {
        storeId: { type: "string", format: "uuid" },
        storeName: { type: "string" },
        chainId: { type: "string", format: "uuid" },
        chainName: { type: "string" },
        total: {
          type: "number",
          description:
            "Sum of priced lines only. When totalScope is priced_lines_only this is not the full basket total.",
        },
        totalScope: basketTotalScopeSchema,
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
    selectionEffect: {
      type: "string",
      enum: ["representative", "brand_family", "pin"],
      description:
        "representative → commodity peers; brand_family → same-brand compatible packs; pin → exact SKU",
    },
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
  required: ["status", "continuation", "questions", "preview", "location"],
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
    items: {
      type: "array",
      items: { type: "object" },
      description: "Present on standard/debug. Omitted from summary to avoid duplicating question options.",
    },
    nextStep: {
      type: "object",
      description: "Present on summary detail — resume with continuation + answers only.",
      required: ["tool", "useOnly", "doNotCall"],
      properties: {
        tool: { type: "string", enum: ["optimize_basket"] },
        useOnly: {
          type: "array",
          items: { type: "string", enum: ["continuation", "answers"] },
        },
        doNotCall: {
          type: "array",
          items: {
            type: "string",
            enum: ["search_products", "resolve_products", "compare_prices"],
          },
        },
      },
    },
    location: storeLocationMetadataSchema,
  },
};

const basketAssumptionSchema = {
  type: "object",
  required: [
    "itemIndex",
    "query",
    "selectedProductId",
    "selectedName",
    "reason",
    "message",
  ],
  properties: {
    itemIndex: { type: "integer" },
    query: { type: "string", nullable: true },
    selectedProductId: { type: "string", format: "uuid", nullable: true },
    selectedName: { type: "string", nullable: true },
    reason: {
      type: "string",
      enum: [
        "commodity_best_effort",
        "generic_variant_default",
        "location_city_fallback",
        "unsafe_line_omitted",
      ],
    },
    message: { type: "string" },
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
    "location",
    "assumptions",
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
              required: ["total", "totalScope", "currency", "storeCount", "lines", "missingItemIndexes"],
              properties: {
                total: {
                  type: "number",
                  description:
                    "Sum of priced lines only. When totalScope is priced_lines_only this is not the full basket total.",
                },
                totalScope: basketTotalScopeSchema,
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
    items: {
      type: "array",
      items: { type: "object" },
      description:
        "summary omits candidates; standard keeps statuses with empty candidates; debug includes candidates.",
    },
    stores: {
      type: "array",
      items: { type: "object" },
      description: "Omitted from summary. standard keeps recommended-store lines; debug keeps all.",
    },
    storesCompared: { type: "integer" },
    storesTruncated: { type: "boolean" },
    location: storeLocationMetadataSchema,
    assumptions: { type: "array", items: basketAssumptionSchema },
    coverage: {
      type: "object",
      required: ["requestedLines", "pricedLines", "omittedLines"],
      properties: {
        requestedLines: { type: "integer" },
        pricedLines: { type: "integer" },
        omittedLines: { type: "integer" },
      },
    },
    omittedItems: {
      type: "array",
      items: {
        type: "object",
        required: ["itemIndex", "query", "reason", "message"],
        properties: {
          itemIndex: { type: "integer" },
          query: { type: "string", nullable: true },
          reason: {
            type: "string",
            enum: [
              "commodity_best_effort",
              "generic_variant_default",
              "location_city_fallback",
              "unsafe_line_omitted",
            ],
          },
          message: { type: "string" },
        },
      },
    },
    timings: {
      type: "object",
      description: "Debug-only phase timings (milliseconds).",
      properties: {
        searchMs: { type: "number" },
        classificationMs: { type: "number" },
        availabilityMs: { type: "number" },
        equivalenceMs: { type: "number" },
        pricingMs: { type: "number" },
      },
    },
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
        "Call once with the original shopping list (city, near, or location required). If status is " +
        "needs_confirmation, ask every returned question and call again with only continuation and " +
        "answers. If status is complete, use bestSingleStore, cheapestCompleteStore, and multiStore. " +
        "Plan totals are the sum of priced lines; check totalScope — priced_lines_only means the total " +
        "is not the full basket. Never reconstruct items and do not call search_products per line. " +
        "Prefer location for neighborhoods/addresses; near remains lat,lng.",
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
