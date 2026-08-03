import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError } from "@super-mcp/shared";
import {
  getDeliveryTerms,
  listDeliveryOptions,
  optimizeDelivery,
} from "../../../services/delivery/index.js";
import type { DeliveryOptimizeRequest } from "../../../services/delivery/index.js";
import { mapMcpItems, mcpAnswerSchema, mcpBasketItemSchema } from "../shared/basketItems.js";
import { registerTool } from "../register.js";
import { resolveToolLocation } from "../shared/location.js";

/**
 * The address shape, which is where this surface visibly parts company with the
 * physical one. There is no `radius_km`: a radius answers "how far will I travel",
 * and the online question is "will they come to me", which the storefront's own
 * service area answers. Coordinates are still accepted because a polygon or a
 * depot radius can only be tested against a point.
 */
const destinationShape = {
  address: z
    .string()
    .min(3)
    .max(300)
    .optional()
    .describe(
      "Delivery address in Israel, free text, e.g. 'מנדלסון 1, תל אביב'. " +
        "Preferred: some storefronts publish a service area that only a street address can be tested against.",
    ),
  city: z
    .string()
    .optional()
    .describe(
      "City name in Hebrew or English. Enough for chains that publish a settlement list, " +
        "not enough for a storefront whose area is a polygon or a depot radius.",
    ),
  near: z
    .string()
    .optional()
    .describe("'lat,lng' string, e.g. '32.078,34.774'. Do not combine with address."),
};

export function registerDeliveryTools(server: McpServer): void {
  registerTool(
    server,
    "optimize_delivery",
    {
      title: "Price a shopping list for delivery",
      description:
        "Price a whole shopping list at every Israeli online supermarket that delivers to an address, " +
        "and rank them on what the order actually costs: items + delivery fee + service fee. " +
        "Call this ONCE with the full list — never price lines separately, and never use optimize_basket " +
        "for a delivery question (that is the drive-to-the-shop tool). " +
        "THE HEADLINE FIGURE IS deliveredTotal, not the item subtotal: a ₪35.90 delivery fee outweighs " +
        "most price differences between chains. " +
        "But RANK on deliveredComparableTotal, never on deliveredTotal: totalScope is priced_lines_only, " +
        "so a storefront that stocks four of your twelve items reports a small deliveredTotal precisely " +
        "because it cannot fill the basket. Check pricedLines against requestedLines and say when the " +
        "coverage is partial. " +
        "Read deliveryTerms.confidence before quoting: 'verified' was read from the retailer's own " +
        "binding terms, 'reported' from a cited secondary source, 'unknown' means no fee is established " +
        "and the ranking used an assumption (assumedDeliveryFee) that must not be repeated as a price. " +
        "deliveryFeeIsFloor=true means the fee is a published lower bound, so quote it as 'from ₪X' and " +
        "treat deliveredTotal as a minimum. " +
        "meetsMinimum=false means the order cannot be placed as it stands; report amountToMinimum, " +
        "the top-up needed. Those plans are still listed, after the orderable ones, so present them " +
        "as options that need topping up rather than hiding them. " +
        "Rank on cheapestDelivered only if the shopper will happily order twice: it prices missing " +
        "lines at a market reference. bestSingleOrder is the fullest basket obtainable in one order. " +
        "Both, and bestVerifiedTerms, carry totals only: find the storefront in plans by serviceSlug " +
        "for its priced lines. " +
        "When nextFeeBreak.worthTopUp is true, spending a little more makes the order cheaper overall — say so. " +
        "Storefronts that do not serve the address come back in unavailableStores with a reason.",
      inputSchema: {
        items: z.array(mcpBasketItemSchema).min(1).max(50).optional()
          .describe("The shopping list. Required unless resuming with a continuation."),
        ...destinationShape,
        preference: z
          .enum(["cheapest", "balanced"])
          .optional()
          .describe(
            "cheapest takes the lowest delivered total outright; balanced (default) prefers a storefront " +
              "whose delivery terms we verified when the money is close.",
          ),
        slot_type: z
          .enum(["standard", "pickup", "express"])
          .optional()
          .describe(
            "standard (default) is delivery to the door. pickup is click-and-collect, which is cheaper " +
              "at chains that offer it but means the shopper travels.",
          ),
        memberships: z
          .array(z.string())
          .optional()
          .describe(
            "Membership or card the shopper holds that unlocks a cheaper rate, e.g. ['credit_card'] " +
              "for a Rami Levy card. Without it the public rate is quoted.",
          ),
        include_club: z
          .boolean()
          .optional()
          .describe("Apply loyalty-club item prices. Default true; they are flagged clubOnly."),
        include_coupon: z
          .boolean()
          .optional()
          .describe("Apply coupon item prices. Default true; they are flagged couponOnly."),
        compare_in_store: z
          .boolean()
          .optional()
          .describe(
            "Also price the same basket at nearby physical branches and report the delivery premium. " +
              "Costs extra latency; use when the shopper is weighing delivery against going themselves.",
          ),
        resolution_mode: z
          .enum(["fast", "strict"])
          .optional()
          .describe(
            "fast (default) makes best-effort product choices and reports them in assumptions. " +
              "strict asks before choosing.",
          ),
        continuation: z
          .string()
          .optional()
          .describe("Opaque token from a needs_confirmation reply. Send with answers and nothing else."),
        answers: z
          .array(mcpAnswerSchema)
          .optional()
          .describe("One answer per question from the needs_confirmation reply."),
      },
    },
    async (args) => {
      const secret = process.env.BASKET_CONTINUATION_SECRET ?? "";
      if (args.continuation) {
        if (args.items) {
          throw new AppError(
            "bad_request",
            "when resuming, send only {continuation, answers} — do not rebuild items",
            400,
          );
        }
        const request: DeliveryOptimizeRequest = {
          continuation: args.continuation,
          answers: (args.answers ?? []).map((a) => ({
            itemIndex: a.item_index,
            productId: a.product_id,
          })),
        };
        return optimizeDelivery(request, { continuationSecret: secret });
      }

      if (!args.items || args.items.length === 0) {
        throw new AppError("bad_request", "items is required for a new delivery request", 400);
      }
      const loc = await resolveToolLocation(
        { city: args.city, near: args.near, location: args.address },
        { geocodeStrategy: args.address ? "precise" : "fast" },
      );
      return optimizeDelivery(
        {
          items: mapMcpItems(args.items),
          address: args.address,
          city: loc.city,
          near: loc.near,
          preference: args.preference,
          slotType: args.slot_type,
          memberships: args.memberships,
          includeClub: args.include_club,
          includeCoupon: args.include_coupon,
          compareInStore: args.compare_in_store,
          resolutionMode: args.resolution_mode,
          locationOrigin: loc.locationOrigin,
        },
        { continuationSecret: secret },
      );
    },
  );

  registerTool(
    server,
    "list_delivery_options",
    {
      title: "List storefronts that deliver here",
      description:
        "Which Israeli online supermarkets deliver to an address, with each one's delivery fee, " +
        "minimum order, free-delivery threshold and whether it offers click-and-collect — without " +
        "pricing a basket. Use for 'who delivers to me?'. For 'what will my shopping cost delivered?', " +
        "use optimize_delivery instead. " +
        "Every entry carries deliveryTerms.confidence and verifiedAt; quote a fee only when it is " +
        "verified or reported, and say the fee is unknown otherwise.",
      inputSchema: {
        ...destinationShape,
        chain: z.string().optional().describe("Chain id (the chain's legal barcode id) to filter by."),
        include_unavailable: z
          .boolean()
          .optional()
          .describe(
            "Also return storefronts that do NOT serve this address, each with a reason. " +
              "Useful for explaining why a well-known chain is missing.",
          ),
      },
    },
    async ({ address, city, near, chain, include_unavailable }) => {
      const loc = await resolveToolLocation(
        { city, near, location: address },
        { geocodeStrategy: address ? "precise" : "fast" },
      );
      const result = await listDeliveryOptions({
        city: loc.city,
        address,
        near: loc.near,
        chainId: chain,
        includeUnavailable: include_unavailable,
      });
      return {
        ...result,
        destination: { requested: address ?? city ?? near ?? null, city: loc.city ?? null },
      };
    },
  );

  registerTool(
    server,
    "get_delivery_terms",
    {
      title: "Get one storefront's delivery terms",
      description:
        "The full published terms for a single online storefront: every fee band over basket size, " +
        "the minimum order, the service area, and where each figure came from. " +
        "Use to explain a deliveryFee an optimize_delivery plan reported, or to answer " +
        "'what do I need to spend for free delivery?'. Take the slug from a plan's serviceSlug.",
      inputSchema: {
        service_slug: z
          .string()
          .min(1)
          .describe("Storefront slug, e.g. 'shufersal-online' — from a plan's serviceSlug."),
      },
    },
    async ({ service_slug }) => getDeliveryTerms(service_slug),
  );
}
