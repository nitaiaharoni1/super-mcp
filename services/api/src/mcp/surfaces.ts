import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDeliveryTools } from "./tools/delivery/index.js";
import { registerOnlineProductTools } from "./tools/products/index.js";
import { registerOnlineStoreTools } from "./tools/stores/index.js";
import { DELIVERY_PROTOCOL_ID, protocolIdentityLine } from "./protocolIdentity.js";

/**
 * Two MCP servers, because a shopper is asking two different questions.
 *
 * "Where do I drive to?" and "what turns up at my door?" look alike — same
 * catalogue, same Hebrew, same promotions — but they are not the same problem,
 * and one tool answering both has to guess which one you meant:
 *
 *                          stores                    online
 *   what it minimises      basket + travel           basket + delivery fee
 *   the cost of distance   ₪/km, a smooth estimate   a published fee, a step
 *                                                    function of the subtotal
 *   feasibility            a branch within radius    the storefront delivers to
 *                                                    your address AND your
 *                                                    basket clears its minimum
 *   "buy the rest          another trip, worth       another delivery fee,
 *    elsewhere" costs      roughly ₪20               worth exactly what it says
 *   what it can't tell     opening hours             whether it is in stock
 *
 * A single surface would have to fold a hard eligibility rule (minimum order) into
 * a soft ranking penalty, and would put `radius_km` next to `delivery_address` in
 * one schema. Splitting them means each tool description can state one job plainly,
 * which is the part of an MCP the model actually reads.
 *
 * They share everything below the objective function: catalogue identity, search,
 * line resolution, unit normalisation, promo maths, freshness. That is the whole
 * reason this is one codebase and one database rather than a fork.
 */
export type McpSurfaceId = "online";

export interface McpSurface {
  id: McpSurfaceId;
  /** Advertised in the MCP initialize response. */
  serverName: string;
  /** HTTP path this surface is mounted at. */
  path: string;
  protocolId: string;
  buildInstructions: (env: NodeJS.ProcessEnv) => string;
  registerTools: (server: McpServer) => void;
}

export function buildStoresInstructions(env: NodeJS.ProcessEnv = process.env): string {
  return (
    "Shopping list → call optimize_basket exactly once with all items and location. " +
    "Accept the default fast best-effort choices unless the user explicitly requests " +
    "exact products; then set resolution_mode=strict. " +
    "Never search or compare each basket line separately. " +
    "Canonical Israeli supermarket product, price, and promotion data. Every price carries freshness: " +
    "ingested_at is when the feed last showed us the item (the staleness signal), source_ts is when " +
    "the chain last CHANGED that price — an old source_ts is normal for a stable price, not stale data. " +
    "Call optimize_basket with items[{query|gtin|product_id, pack_qty|amount+unit}] " +
    "and city (Hebrew/English), near=lat,lng, or location (free-text neighborhood/address, e.g. " +
    "'נווה עמל, הרצליה'). Prefer location for neighborhoods; near remains coordinates. Do not combine " +
    "near with location. If status is needs_confirmation, answer every required question and call again " +
    "with only {continuation, answers}. If status is complete, use bestSingleStore / cheapestCompleteStore " +
    "/ closestStore / multiStore. Compare stores on comparableTotal (same-basket figure that adds a " +
    "market reference price for lines a store does not stock); raw total covers priced lines only, so " +
    "check totalScope. Set preference=cheapest when the shopper says distance does not matter, " +
    "preference=closest when they say price is not a big factor, else leave it balanced. " +
    "Conditional prices are flagged: clubOnly needs the chain loyalty card and couponOnly " +
    "needs a clipped coupon (plans report clubOnlyLines / couponOnlyLines) — say so rather " +
    "than quoting them as the price anyone pays. " +
    "Use search_products / resolve_products only for unresolved or missing lines. " +
    "Use pack_qty alone for pack counts (3 milk cartons: pack_qty=3). " +
    "Use amount+unit for natural counts and weighed goods " +
    "(20 pitas: amount=20, unit=יח; 1.5kg: amount=1.5, unit=kg). " +
    "If pack_qty is paired with a count unit (unit/יח), the unit is ignored. " +
    "Location filters default to 10km when a " +
    "point is resolved. Use get_promotions to explain discounts. " +
    "This tool set prices shelves at physical branches. It is not mounted: the live " +
    "SuperMCP server is online delivery at /mcp (optimize_delivery). " +
    protocolIdentityLine(env)
  );
}

export function buildOnlineInstructions(env: NodeJS.ProcessEnv = process.env): string {
  return (
    "Shopping list to be DELIVERED → call optimize_delivery exactly once with all items and " +
    "the delivery address. Never price each line separately. " +
    "Israeli online supermarket storefronts: catalogue, price and promotion data from the same " +
    "regulated feeds as the shelf prices, plus each storefront's delivery terms. " +
    "Online prices are NOT shelf prices — a chain's website runs its own price book, so quote " +
    "what this server returns rather than a branch price. " +
    "Call optimize_delivery with items[{query|gtin|product_id, pack_qty|amount+unit}] and " +
    "address (free-text, e.g. 'מנדלסון 1, תל אביב') or city. " +
    "If status is needs_confirmation, answer every required question and call again with only " +
    "{continuation, answers}. " +
    "THE HEADLINE NUMBER IS deliveredTotal, not the item subtotal: a ₪29 delivery fee outweighs " +
    "most price differences between chains, so a storefront with dearer items can still win. " +
    "Read each plan's itemsSubtotal, deliveryFee, deliveredTotal and deliveryTerms.confidence. " +
    "Compare storefronts on deliveredComparableTotal, never on deliveredTotal: totalScope is " +
    "priced_lines_only, so a storefront that stocks four of your twelve items reports a small " +
    "deliveredTotal precisely because it cannot fill the basket. pricedLines out of requestedLines " +
    "says how much of the list a plan actually covers, and imputedLines how many the comparable " +
    "figure had to price at a market reference. Say so when coverage is partial. " +
    "deliveryTerms.confidence=verified means we checked the retailer's own published terms on " +
    "deliveryTerms.verifiedAt; reported means a cited secondary source. When it is unknown the fee " +
    "is null and the ranking used assumedDeliveryFee, which is NOT a price and must not be " +
    "repeated as one. " +
    "When deliveryFeeIsFloor is true the fee is a published lower bound (a marketplace sets the " +
    "real figure at checkout from the distance), so say 'from ₪X' and treat deliveredTotal as a " +
    "minimum. " +
    "meetsMinimum=false means the order CANNOT be placed as it stands: report amountToMinimum, " +
    "the shekels of extra goods needed. Such a plan still appears in plans, after every orderable " +
    "one, because a storefront held back only by its minimum is the shopper's call to make. Show " +
    "it as an option that needs a top-up of that many shekels, never as one they can order now. " +
    "cheapestDelivered ranks on a total that prices missing lines at a market reference, so it can " +
    "win by not stocking things; bestSingleOrder is the most of the list obtainable in ONE order. " +
    "When they differ, say so and let the shopper choose. Those three recommendation fields carry " +
    "the totals only; look the storefront up in plans by serviceSlug for its priced lines. " +
    "nextFeeBreak names a cheaper fee tier the shopper could reach: gap is the extra spend, saving " +
    "is what it takes off the fee, and worthTopUp=true means spending it leaves them better off " +
    "overall. Volunteer that unprompted. " +
    "Storefronts that do not serve the address are returned in unavailableStores with a reason, " +
    "not silently dropped. " +
    "Conditional prices are flagged exactly as on the shelf: clubOnly needs the chain loyalty " +
    "card, couponOnly needs a clipped coupon. " +
    "Set preference=cheapest to take the lowest delivered figure outright; leave it balanced " +
    "(default) to prefer a storefront whose terms we verified when the money is close. " +
    "Set slot_type=pickup for click-and-collect, which is cheaper where offered but means the " +
    "shopper travels. " +
    "Use list_delivery_options to answer 'who delivers to me' without pricing a basket, and " +
    "get_delivery_terms for one storefront's fee schedule, minimum and slots. " +
    "Use search_products / get_promotions for single lines only. " +
    "This is the SuperMCP server: Israeli online supermarket delivery and click-and-collect. " +
    protocolIdentityLine(env, DELIVERY_PROTOCOL_ID)
  );
}

/** The only live MCP: online supermarket delivery at the canonical /mcp path. */
const ONLINE_SURFACE: McpSurface = {
  id: "online",
  serverName: "super-mcp",
  path: "/mcp",
  protocolId: DELIVERY_PROTOCOL_ID,
  buildInstructions: buildOnlineInstructions,
  registerTools(server) {
    // Order matters: optimize_delivery leads tool discovery.
    registerDeliveryTools(server);
    registerOnlineProductTools(server);
    registerOnlineStoreTools(server);
  },
};

/** Same online tools at the old path so existing /mcp/online clients keep working. */
const ONLINE_COMPAT_ALIAS: McpSurface = {
  ...ONLINE_SURFACE,
  path: "/mcp/online",
};

export const MCP_SURFACES: Record<McpSurfaceId, McpSurface> = {
  online: ONLINE_SURFACE,
};

/**
 * Surfaces this process mounts. Always the online supermarket MCP at `/mcp`,
 * plus `/mcp/online` as a compatibility alias. Physical `stores` cannot be enabled.
 */
export function enabledSurfaces(env: NodeJS.ProcessEnv = process.env): McpSurface[] {
  const raw = env.SUPER_MCP_SURFACES?.trim();
  if (!raw || raw.toLowerCase() === "online") {
    return [ONLINE_SURFACE, ONLINE_COMPAT_ALIAS];
  }
  if (raw.split(",").some((id) => id.trim().toLowerCase() === "stores")) {
    throw new Error(
      "SUPER_MCP_SURFACES=stores is disabled: SuperMCP serves only the online supermarket " +
        "surface at /mcp (and /mcp/online as an alias). Unset SUPER_MCP_SURFACES or set it to online.",
    );
  }
  throw new Error(
    `SUPER_MCP_SURFACES lists an unknown surface: ${raw}. Only online is served.`,
  );
}
