import { errorResponses, freshnessSchema, withData } from "./common.js";
import { storeLocationMetadataSchema } from "./stores.js";

export const basketItemInputSchema = {
  type: "object",
  allOf: [{ not: { required: ["pack_qty", "qty"] } }],
  properties: {
    product_id: { type: "string", format: "uuid" },
    gtin: { type: "string" },
    query: { type: "string" },
    pack_qty: {
      type: "number",
      minimum: 0,
      exclusiveMinimum: true,
      description: "Number of product packs to buy. Mutually exclusive with deprecated qty.",
    },
    qty: {
      type: "number",
      minimum: 0,
      exclusiveMinimum: true,
      deprecated: true,
      description: "Deprecated alias for pack_qty. Do not supply both.",
    },
    amount: {
      type: "number",
      minimum: 0,
      exclusiveMinimum: true,
      description: "Physical amount (requires unit), e.g. 1.5 with unit=kg.",
    },
    unit: {
      type: "string",
      description:
        "Required with amount: kg, g, L, ml, unit, יח, etc. Natural counts use amount+unit (20 pitas: amount=20, unit=יח or unit).",
    },
  },
  description:
    "One of product_id, gtin, or query; and pack_qty (deprecated: qty) or amount+unit. pack_qty and qty are mutually exclusive.",
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

export const basketPrepareRequestSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: basketItemInputSchema, minItems: 1, maxItems: 50 },
    ...basketLocationRequestProperties,
  },
};

export const basketOptimizeRequestSchema = {
  type: "object",
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
  },
};

export const basketSubstitutionSchema = {
  type: "object",
  nullable: true,
  description:
    "Present when free-text resolution picked a different product than the top lexical match (e.g. locally stocked twin).",
  properties: {
    originalProductId: { type: "string", format: "uuid", nullable: true },
    originalName: { type: "string", nullable: true },
    selectedProductId: { type: "string", format: "uuid" },
    selectedName: { type: "string" },
    reason: { type: "string" },
    changedAttributes: {
      type: "array",
      items: { type: "string" },
      description: "Soft attribute differences allowed by intent gates (never hard conflicts).",
    },
    confidence: { type: "number", nullable: true },
  },
};

export const basketLineSchema = {
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
    substituted: {
      type: "boolean",
      description: "True when a lower-ranked candidate was used because the primary SKU wasn't stocked.",
    },
    substitutionReason: { type: "string", nullable: true },
    originalProductId: { type: "string", format: "uuid", nullable: true },
    link: {
      type: "string",
      nullable: true,
      description: "Clickable storefront URL to open this product on the chain's site. Null when the chain has no online store.",
    },
    freshness: freshnessSchema,
  },
};

export const basketCandidateSchema = {
  type: "object",
  properties: {
    productId: { type: "string", format: "uuid" },
    name: { type: "string" },
    score: { type: "number" },
    matchedVia: {
      type: "string",
      enum: ["product", "listing", "gtin", "vector", "alias"],
    },
    sizeQty: { type: "number", nullable: true },
    sizeUnit: { type: "string", nullable: true },
    hasPrice: { type: "boolean" },
    hasLocalPrice: {
      type: "boolean",
      description: "True when priced in the requested city/near/store scope.",
    },
  },
};

export const basketMissingItemSchema = {
  type: "object",
  properties: {
    itemIndex: { type: "integer" },
    productId: { type: "string", format: "uuid", nullable: true },
    name: { type: "string", nullable: true },
    reason: { type: "string", enum: ["product_not_found", "not_carried_by_chain", "no_price_data"] },
  },
};

export const basketCompletenessSchema = {
  type: "object",
  description:
    "Resolution coverage for the basket. When safeResolutionRatio is below minSafeResolutionRatio (default 0.7), totalsArePartial is true: cheapest/multiStore cover only the resolved subset and the remaining lines are returned as questions.",
  properties: {
    requestedLines: { type: "integer", description: "Total lines in the request." },
    resolvedLines: {
      type: "integer",
      description: "Lines with a high-confidence productId suitable for auto-pricing.",
    },
    needsConfirmationLines: {
      type: "integer",
      description: "Ambiguous lines with candidates but no auto-selected productId.",
    },
    unresolvedLines: { type: "integer", description: "Lines with no safe match." },
    safeResolutionRatio: {
      type: "number",
      description: "resolvedLines / requestedLines (0–1).",
    },
    totalsArePartial: {
      type: "boolean",
      description:
        "True when safeResolutionRatio is below the ontology minSafeResolutionRatio; cheapest/multiStore cover only the resolved subset (unconfirmed lines are in questions) and must not be treated as full-list cheapest.",
    },
  },
};

export const basketOptimizeResponseSchema = {
  type: "object",
  properties: {
    completeness: basketCompletenessSchema,
    location: storeLocationMetadataSchema,
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          qty: { type: "number" },
          qtyMode: { type: "string" },
          amount: { type: "number", nullable: true },
          unit: { type: "string", nullable: true },
          productId: { type: "string", format: "uuid", nullable: true },
          name: { type: "string", nullable: true },
          resolved: { type: "boolean" },
          resolvedBy: { type: "string", enum: ["product_id", "gtin", "query", "unresolved"] },
          resolutionStatus: {
            type: "string",
            enum: ["resolved", "needs_confirmation", "unresolved"],
            description: "Deterministic resolution outcome. Only resolved lines are auto-priced.",
          },
          confidence: { type: "number", nullable: true },
          lowConfidence: {
            type: "boolean",
            description:
              "True when the match is ambiguous or below the strong threshold. Strong hits still auto-price; verify candidates when true. Weak hits leave productId null.",
          },
          candidates: { type: "array", items: basketCandidateSchema },
          substitution: basketSubstitutionSchema,
        },
      },
    },
    storesCompared: { type: "integer" },
    storesTruncated: { type: "boolean" },
    multiStore: {
      type: "object",
      nullable: true,
      description: "Cheapest per item across stores (may need multiple trips).",
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
    questions: {
      type: "array",
      description:
        "Confirmations for lines that still need a human decision (same shape as prepare_basket questions). " +
        "Totals cover only the resolved subset (see completeness.totalsArePartial); re-call optimize with " +
        "product_id answers to price these lines too.",
      items: {
        type: "object",
        required: ["itemIndex", "id", "prompt", "reason", "required", "options"],
        properties: {
          itemIndex: { type: "integer" },
          id: { type: "string", description: "Stable question identifier for this basket line." },
          prompt: { type: "string" },
          reason: { type: "string" },
          required: { type: "boolean" },
          options: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                productId: { type: "string", format: "uuid" },
                name: { type: "string" },
                sizeQty: { type: "number", nullable: true },
                sizeUnit: { type: "string", nullable: true },
                hasLocalPrice: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};

export const basketPrepareResponseSchema = {
  type: "object",
  properties: {
    completeness: basketCompletenessSchema,
    location: storeLocationMetadataSchema,
    items: basketOptimizeResponseSchema.properties.items,
    assumptions: {
      type: "array",
      items: { type: "string" },
      description: "Safe automatic query-to-product selections made during preparation.",
    },
    questions: {
      type: "array",
      description: "Required confirmations derived from needs_confirmation lines.",
      items: {
        type: "object",
        required: ["itemIndex", "id", "prompt", "reason", "required", "options"],
        properties: {
          itemIndex: { type: "integer" },
          id: { type: "string", description: "Stable question identifier for this basket line." },
          prompt: { type: "string" },
          reason: { type: "string" },
          required: { type: "boolean" },
          options: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                productId: { type: "string", format: "uuid" },
                name: { type: "string" },
                sizeQty: { type: "number", nullable: true },
                sizeUnit: { type: "string", nullable: true },
                hasLocalPrice: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};

export const basketComponentSchemas = {
  BasketPrepareRequest: basketPrepareRequestSchema,
  BasketPrepareResponse: basketPrepareResponseSchema,
  BasketOptimizeRequest: basketOptimizeRequestSchema,
  BasketOptimizeResponse: basketOptimizeResponseSchema,
};

export const basketPaths = {
  "/v1/basket/prepare": {
    post: {
      summary: "Resolve a basket and return required confirmations",
      description:
        "First step for shopping lists. Resolves product candidates near the requested location without loading basket prices. Answer every required question, then optimize with confirmed product_id values.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: basketPrepareRequestSchema } },
      },
      responses: {
        "200": {
          description: "Prepared basket",
          content: { "application/json": { schema: withData(basketPrepareResponseSchema) } },
        },
        ...errorResponses,
      },
    },
  },
  "/v1/basket/optimize": {
    post: {
      summary: "Find the cheapest basket nearby (default 10km)",
      description:
        "One-shot: prices the safely-resolved lines immediately and returns any lines that still need a human " +
        "decision as `questions` (same shape as prepare_basket). Prefer pack_qty for packs (qty is a deprecated " +
        "alias; do not supply both); use amount+unit for weighed goods and natural counts. Requires city or near. " +
        "Returns cheapest, multiStore, trimmed store breakdowns, completeness, questions, and location metadata. " +
        "When completeness.totalsArePartial is true, totals cover only the resolved subset — re-call with " +
        "product_id answers to the questions to finalize.",
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
};

/** MCP tools backed by the basket service layer. */
export const basketMcpTools = ["prepare_basket", "optimize_basket"] as const;
