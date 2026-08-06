import { basketItemInputSchema } from "./basket.js";
import { errorResponses, withData } from "./common.js";

export const deliveryMcpTools = [
  "optimize_delivery",
  "list_delivery_options",
  "get_delivery_terms",
];

const destinationProperties = {
  address: {
    type: "string",
    minLength: 3,
    maxLength: 300,
    description:
      "Delivery address in Israel, free text, e.g. 'מנדלסון 1, תל אביב'. Preferred: a storefront whose " +
      "service area is a polygon or a depot radius can only be tested against a located point.",
  },
  city: {
    type: "string",
    description:
      "Hebrew or English city (or CBS locality code). Enough for a chain that publishes a settlement " +
      "list; not enough for a polygon or radius service area.",
  },
  near: { type: "string", description: "'lat,lng', e.g. '32.078,34.774'. Do not combine with address." },
};

const termsProvenanceSchema = {
  type: "object",
  description:
    "Where this storefront's fee came from. Item prices are regulated feed data; delivery terms are read " +
    "by a human off a retailer's terms page, so they carry their own provenance and decay.",
  properties: {
    confidence: {
      type: "string",
      enum: ["verified", "reported", "estimated", "unknown"],
      description:
        "verified: read from the retailer's own binding terms on verifiedAt. reported: a cited secondary " +
        "source. estimated: a category default. unknown: no fee is established, or the figure is past its " +
        "90-day TTL — do not quote it.",
    },
    verifiedAt: { type: "string", format: "date", nullable: true },
    sourceUrl: { type: "string", nullable: true },
    stale: { type: "boolean", description: "True when the figure is older than the terms TTL." },
  },
};

const coverageReportSchema = {
  type: "object",
  properties: {
    serves: { type: "boolean" },
    matchedScope: {
      type: "string",
      nullable: true,
      enum: ["national", "city", "radius", "polygon", null],
    },
    confidence: { type: "string", nullable: true, enum: ["verified", "reported", "estimated", null] },
    reason: {
      type: "string",
      nullable: true,
      enum: ["outside_service_area", "address_too_vague", "coverage_unknown", null],
      description:
        "Why it does not serve the address. coverage_unknown means WE have no service area recorded, " +
        "which is not the same as the retailer refusing.",
    },
  },
};

const feeBreakSchema = {
  type: "object",
  nullable: true,
  description:
    "A cheaper fee tier reachable by spending more. Not only free delivery: Shufersal's pickup fee drops " +
    "₪15 → ₪10 above ₪750 without reaching zero, and that is the same advice.",
  properties: {
    atSubtotal: { type: "number" },
    fee: { type: "number" },
    gap: { type: "number", description: "Shekels of extra goods needed." },
    saving: { type: "number", description: "Shekels saved on the fee." },
    worthTopUp: {
      type: "boolean",
      description: "True when the gap costs less than the saving, i.e. spending more leaves them better off.",
    },
  },
};

const deliveryPlanSchema = {
  type: "object",
  properties: {
    serviceSlug: { type: "string" },
    brand: { type: "string" },
    serviceType: { type: "string", enum: ["delivery", "pickup", "marketplace"] },
    marketplace: { type: "string", nullable: true },
    storefrontUrl: { type: "string", nullable: true },
    chainId: { type: "string" },
    chainName: { type: "string" },
    storeId: { type: "string", format: "uuid" },
    currency: { type: "string" },
    itemsSubtotal: { type: "number", description: "Goods at this storefront, over the lines it prices." },
    itemsComparableSubtotal: {
      type: "number",
      description: "Same-basket item figure: adds a market reference price for lines it does not stock.",
    },
    totalScope: { type: "string", enum: ["complete_basket", "priced_lines_only"] },
    deliveryFee: {
      type: "number",
      nullable: true,
      description: "null means NOT KNOWN. Never read it as free.",
    },
    assumedDeliveryFee: {
      type: "number",
      nullable: true,
      description:
        "Ranking-only stand-in used when deliveryFee is null, set to the market's verified ₪35.90. " +
        "Never quote it to a shopper as the price.",
    },
    deliveryFeeIsFloor: {
      type: "boolean",
      description:
        "True when deliveryFee is a published LOWER BOUND, not the charge (a marketplace sets the real " +
        "figure at checkout from the distance). Quote it as 'from ₪X'; deliveredTotal is a minimum too.",
    },
    serviceFee: { type: "number", description: "Marketplace operations fee (דמי תפעול); 0 for chains." },
    deliveredTotal: {
      type: "number",
      nullable: true,
      description:
        "THE HEADLINE FIGURE: itemsSubtotal + deliveryFee + serviceFee. null when the fee is unknown.",
    },
    deliveredComparableTotal: {
      type: "number",
      description: "What storefronts are ranked on: same basket everywhere, plus fees. Always present.",
    },
    deliveryTerms: termsProvenanceSchema,
    meetsMinimum: {
      type: "boolean",
      description: "False means the order CANNOT be placed as it stands. Never present it as available.",
    },
    minimumOrder: { type: "number", nullable: true },
    amountToMinimum: { type: "number", nullable: true, description: "Shekels of goods still needed." },
    minimumKnown: { type: "boolean" },
    requiresMembership: {
      type: "string",
      nullable: true,
      description: "Set when this rate needs a card or subscription, e.g. 'credit_card', 'wolt_plus'.",
    },
    coverage: coverageReportSchema,
    freeDeliveryThreshold: { type: "number", nullable: true },
    nextFeeBreak: feeBreakSchema,
    pricedLines: { type: "integer" },
    resolvableLines: { type: "integer" },
    requestedLines: { type: "integer" },
    coverageRatio: { type: "number" },
    imputedTotal: { type: "number" },
    imputedLines: { type: "integer" },
    clubOnlyLines: { type: "integer" },
    couponOnlyLines: { type: "integer" },
    stalePricedLines: {
      type: "integer",
      description:
        "Priced lines whose price the retailer last republished over 30 days ago. Rami Levy's " +
        "storefront runs 44.6% stale by this measure and every other storefront 0%, so it is worth " +
        "saying out loud rather than quoting a thirteen-month-old price as today's.",
    },
    lines: { type: "array", items: { $ref: "#/components/schemas/BasketLine" } },
    missingItems: { type: "array", items: { type: "object" } },
  },
};

export const deliveryComponentSchemas = {
  DeliveryPlan: deliveryPlanSchema,
  // The recommendation fields name a storefront that `plans` already carries in
  // full, so they ship without the line arrays: repeating them was a quarter of
  // the response on a 12-line basket. Look the storefront up in `plans` by
  // `serviceSlug` for its priced lines.
  DeliveryPlanSummary: {
    ...deliveryPlanSchema,
    properties: Object.fromEntries(
      Object.entries(deliveryPlanSchema.properties).filter(
        ([key]) => key !== "lines" && key !== "missingItems" && key !== "linesTruncated",
      ),
    ),
  },
  DeliveryTermsProvenance: termsProvenanceSchema,
  DeliveryCoverageReport: coverageReportSchema,
};

const optimizeDeliveryBody = {
  type: "object",
  additionalProperties: false,
  description:
    "Either an initial request (items + a destination) or a resume ({continuation, answers} only).",
  properties: {
    items: { type: "array", minItems: 1, maxItems: 50, items: basketItemInputSchema },
    ...destinationProperties,
    preference: {
      type: "string",
      enum: ["cheapest", "balanced"],
      description:
        "cheapest takes the lowest delivered figure outright; balanced (default) prefers a storefront " +
        "whose terms we verified when the money is close.",
    },
    slot_type: {
      type: "string",
      enum: ["standard", "pickup", "express"],
      description: "pickup is click-and-collect: cheaper where offered, but the shopper travels.",
    },
    memberships: {
      type: "array",
      items: { type: "string" },
      description: "Cards or subscriptions the shopper holds that unlock a cheaper rate.",
    },
    include_club: { type: "boolean", default: true },
    include_coupon: { type: "boolean", default: true },
    resolution_mode: { type: "string", enum: ["fast", "strict"] },
    continuation: { type: "string" },
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item_index: { type: "integer", minimum: 0 },
          product_id: { type: "string", format: "uuid" },
        },
        required: ["item_index", "product_id"],
      },
    },
  },
};

export const deliveryPaths = {
  "/v1/delivery/optimize": {
    post: {
      operationId: "optimizeDelivery",
      summary: "Price a shopping list for delivery across online storefronts",
      description:
        "Prices a whole basket at every Israeli online supermarket that delivers to an address and ranks " +
        "them on what the ORDER costs, not what the goods cost. Online prices are not shelf prices: a " +
        "chain's website runs its own price book (measured: Rami Levy's online store shares 22% of its " +
        "prices with its own branches; Carrefour's runs ~8% below its shelves), so every figure comes from " +
        "the storefront's own regulated feed rows. " +
        "Storefronts that do not serve the address, or where the basket is below the minimum order, are " +
        "returned in unavailableStores with a reason rather than dropped.",
      tags: ["delivery"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: optimizeDeliveryBody } },
      },
      responses: {
        200: withData({
          type: "object",
          properties: {
            status: { type: "string", enum: ["complete", "needs_confirmation"] },
            currency: { type: "string" },
            address: { type: "object" },
            preference: { type: "string" },
            slotType: { type: "string" },
            cheapestDelivered: { $ref: "#/components/schemas/DeliveryPlanSummary" },
            bestVerifiedTerms: { $ref: "#/components/schemas/DeliveryPlanSummary" },
            bestSingleOrder: { $ref: "#/components/schemas/DeliveryPlanSummary" },
            plans: { type: "array", items: { $ref: "#/components/schemas/DeliveryPlan" } },
            unavailableStores: { type: "array", items: { type: "object" } },
            items: { type: "array", items: { type: "object" } },
            assumptions: { type: "array", items: { type: "object" } },
            storefrontsCompared: { type: "integer" },
            notes: { type: "array", items: { type: "string" } },
          },
        }),
        ...errorResponses,
      },
    },
  },
  "/v1/delivery/options": {
    get: {
      operationId: "listDeliveryOptions",
      summary: "Which online storefronts deliver to an address",
      description:
        "The online counterpart to /v1/stores. Answers 'who will come to me, on what terms, and how sure " +
        "are we' rather than 'what is near me'. Set include_unavailable=true to see storefronts that do " +
        "NOT serve the address, each with a reason.",
      tags: ["delivery"],
      parameters: [
        ...Object.entries(destinationProperties).map(([name, schema]) => ({
          name,
          in: "query",
          schema,
          description: (schema as { description?: string }).description,
        })),
        { name: "chain", in: "query", schema: { type: "string" } },
        { name: "include_unavailable", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        200: withData({
          type: "object",
          properties: {
            options: { type: "array", items: { type: "object" } },
            destinationKnown: { type: "boolean" },
          },
        }),
        ...errorResponses,
      },
    },
  },
  "/v1/delivery/services/{slug}": {
    get: {
      operationId: "getDeliveryTerms",
      summary: "One storefront's full published delivery terms",
      description:
        "Every fee band over basket size, the minimum order, the service area, and where each figure came " +
        "from. Use to explain a plan's deliveryFee, or to answer 'what do I need to spend for free delivery?'.",
      tags: ["delivery"],
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Storefront slug, e.g. 'shufersal-online' — from a plan's serviceSlug.",
        },
      ],
      responses: {
        200: withData({ type: "object" }),
        ...errorResponses,
      },
    },
  },
};
