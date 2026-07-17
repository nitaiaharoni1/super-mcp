import type { StoreLocationHint } from "../../regions.js";

/** Extract Azure blob / xml feed links from portal HTML (entities decoded). */
export function extractFeedHrefs(html: string): Set<string> {
  const hrefs = new Set<string>();
  const decoded = html.replace(/&amp;/g, "&");

  for (const m of decoded.matchAll(
    /https:\/\/pricesprodpublic\.blob\.core\.windows\.net\/[^\s"'<>]+/gi,
  )) {
    hrefs.add(m[0]!.replace(/&amp;/g, "&"));
  }
  for (const m of decoded.matchAll(/href=["']([^"']+\.xml(?:\.gz)?)["']/gi)) {
    hrefs.add(m[1]!);
  }
  for (const m of decoded.matchAll(
    /(https?:\/\/[^"'\s]+(?:PriceFull|PromoFull|Stores|Price|Promo)[^"'\s]*\.(?:xml(?:\.gz)?|gz))/gi,
  )) {
    hrefs.add(m[1]!);
  }
  return hrefs;
}

/** Parse `#ddlStore` options → storeId + Hebrew label for region matching. */
export function parseStoreDropdown(html: string): StoreLocationHint[] {
  const out: StoreLocationHint[] = [];
  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  for (const m of decoded.matchAll(
    /<option\s+value="(\d+)"[^>]*>([^<]*)<\/option>/gi,
  )) {
    const id = m[1]!;
    if (id === "0") continue; // "All"
    const label = m[2]!.replace(/\s+/g, " ").trim();
    out.push({ storeId: id, name: label });
  }
  return out;
}

export function maxPageFromHtml(html: string): number {
  let max = 1;
  for (const m of html.matchAll(/(?:[?&]|amp;)page=(\d+)/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
