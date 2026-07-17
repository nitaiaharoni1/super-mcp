import { STOREFRONTS } from "./storefronts.js";
import type { ProductLink, ProductLinkInput, Storefront } from "./types.js";

/** Build the retailer product link for one chain + product, or explain why none exists. */
export function buildProductLink(input: ProductLinkInput): ProductLink {
  const storefront = STOREFRONTS[input.chainId] as Storefront | null | undefined;
  if (storefront === null) return { url: null, via: null, reason: "no_online_store" };
  if (storefront === undefined) return { url: null, via: null, reason: "unmapped_chain" };

  if (input.gtin && storefront.barcodeUrl) {
    return { url: storefront.barcodeUrl(input.gtin), via: "barcode" };
  }
  const name = input.name?.trim();
  if (name && storefront.nameUrl) {
    return { url: storefront.nameUrl(name), via: "name" };
  }
  return { url: null, via: null, reason: "no_identifier" };
}
