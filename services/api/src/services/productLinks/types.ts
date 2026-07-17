/**
 * Per-chain "open this product on the retailer's site" links — the zero-install
 * handoff. Each URL lands the shopper on the product's real page on the retailer's
 * own storefront, where the retailer's add-to-cart button does the work. Chain-level
 * (national storefront + in-site branch selector), not branch-specific.
 *
 * Verified live 2026-07-17. Preference order:
 *   1. barcode search (precise — resolves to the single product), when the storefront
 *      indexes by barcode and we have the GTIN;
 *   2. name search (fallback — lands on a result list), for storefronts that don't
 *      index barcodes (Shufersal) or for non-GTIN items (weighed produce) with no barcode.
 *
 * We deliberately do NOT deep-link to product-detail pages: those are keyed by
 * chain-internal ids (Shufersal מק"ט, stor.ai catalogProduct id) that the government
 * price feed does not publish, so we can't build them from stored data. Search-by-GTIN
 * is the only precise key we actually hold.
 */

export interface ProductLinkInput {
  /** chain.id (the legal chain barcode), e.g. "7290027600007" for Shufersal. */
  chainId: string;
  /** Canonical GTIN, when known. Null for non-GTIN items (e.g. weighed produce). */
  gtin: string | null;
  /** Display name, used for the name-search fallback. Prefer the chain's own listing name. */
  name: string;
}

export type ProductLinkReason =
  | "no_online_store" // chain operates no online storefront (e.g. Osher Ad)
  | "unmapped_chain" // chain not in the storefront table yet
  | "no_identifier"; // neither a barcode nor a usable name to search with

export interface ProductLink {
  /** Clickable storefront URL, or null when one can't be built (see reason). */
  url: string | null;
  /** How the URL locates the product. Null when url is null. */
  via: "barcode" | "name" | null;
  reason?: ProductLinkReason;
}

export interface Storefront {
  /** Search the storefront by GTIN. Omitted when the site can't search by barcode. */
  barcodeUrl?: (gtin: string) => string;
  /** Search the storefront by product name. */
  nameUrl?: (name: string) => string;
}
