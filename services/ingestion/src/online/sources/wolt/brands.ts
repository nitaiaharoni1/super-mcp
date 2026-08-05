/**
 * Which Wolt brands we ingest, and the chain each becomes.
 *
 * Two decisions live here, both of which cost a production incident to learn.
 *
 * ONE CHAIN PER BRAND, never a single "Wolt" chain. A Wolt venue sets Wolt's
 * price, not the chain's: measured against the exact branch that fills the order,
 * Wolt runs about +25% on the one venue that also files a regulated feed. So
 * "Victory on Wolt" is a different price book from "Victory", and a shopper
 * comparing them has to see two named options rather than one chain whose price
 * silently depends on which source last wrote it. Collapsing every venue into
 * `IL-WOLT` also made the two indistinguishable in results.
 *
 * AN ALLOWLIST, never a product-line filter. Wolt's own `product_line` field is
 * far too coarse: `alcohol` admitted "123 יין ואלכוהול", `general_merchandise`
 * admitted Adidas stores, a hookah shop and a cosmetics shop, and even the narrow
 * `grocery` + `convenience` pair admits 517 venues across 276 brands, 211 of them
 * a single independent corner shop. Because a store row alone is enough to become
 * an active fulfillment_service, those venues went live as delivery storefronts
 * stocking nothing.
 *
 * WHAT EARNS A PLACE. Not "is it a grocery" but "does it add an option the
 * shopper does not already have":
 *
 *   - Wolt Market is Wolt's own grocery brand and exists in no feed at all.
 *   - Victory and Machsanei Hashuk file prices we already hold, but neither
 *     publishes a priced online storefront, so today they cannot be ordered from
 *     at any price. Wolt is the only way they become orderable. It is also a
 *     FRESHER source for them: their transparency portal has published nothing
 *     since 2026-07-28, so the feed prices are frozen while Wolt's are current.
 *
 * Deliberately absent: Shufersal, Carrefour, Rami Levy and Tiv Taam. All four
 * already have their own priced online storefronts, so their Wolt venues would
 * add a reliably dearer duplicate that can never win a comparison. Adding one is
 * a single entry here if that ever changes.
 */
export interface WoltBrand {
  /** Chain id these venues are filed under. */
  chainId: string;
  he: string;
  en: string;
  /**
   * Lowercased needles matched against the venue name. Wolt writes a venue as
   * "Brand | Branch", so the brand is a prefix, but the name is user-facing text
   * and its spelling drifts; a needle list is more durable than one exact string.
   */
  match: readonly string[];
}

export const WOLT_BRANDS: readonly WoltBrand[] = [
  {
    chainId: "IL-WOLT-MARKET",
    he: "וולט מרקט",
    en: "Wolt Market",
    match: ["wolt market", "וולט מרקט"],
  },
  {
    chainId: "IL-WOLT-VICTORY",
    he: "ויקטורי-וולט",
    en: "Victory (Wolt)",
    match: ["victory", "ויקטורי"],
  },
  {
    chainId: "IL-WOLT-MACHSANEI",
    he: "מחסני השוק-וולט",
    en: "Machsanei Hashuk (Wolt)",
    match: ["machsanei", "מחסני השוק"],
  },
];

/**
 * The brand a venue belongs to, or null when it is not one we ingest.
 *
 * Matches on the brand segment before Wolt's "|" separator when present, so a
 * branch named after another chain ("am:pm | ויקטוריה") cannot be mistaken for
 * the brand it merely mentions.
 */
export function woltBrandForVenue(venueName: string): WoltBrand | null {
  const full = venueName.toLowerCase();
  const brandSegment = (full.split("|")[0] ?? full).trim();
  for (const brand of WOLT_BRANDS) {
    if (brand.match.some((needle) => brandSegment.includes(needle))) return brand;
  }
  return null;
}

/** Chain ids this source can produce, for the pipeline's expected-chain check. */
export const WOLT_CHAIN_IDS: readonly string[] = WOLT_BRANDS.map((b) => b.chainId);
