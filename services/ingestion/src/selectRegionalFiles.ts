import type { FeedFile } from "@super-mcp/shared";
import {
  allowedStoreCodesFromLocations,
  isOrderableStorefront,
  onlineStoresOnly,
  regionFilterEnabled,
  type StoreLocationHint,
} from "./regions.js";
import { normalizeStoreCode } from "./storeCode.js";

/**
 * Keep Stores files always; keep PriceFull/PromoFull only for stores we can
 * actually sell from, capped at maxStores distinct store codes per kind.
 *
 * Two filters, in precedence order. The online filter asks "can a shopper order
 * from this?" and the region filter asks "is this branch near our users?". The
 * first subsumes the second: where a delivery depot physically sits says nothing
 * about where it delivers, so once we are keeping only depots there is nothing
 * left for a bounding box to decide.
 */
export function selectRegionalFeedFiles(
  files: FeedFile[],
  storeLocations: StoreLocationHint[],
  maxStores: number,
): FeedFile[] {
  const online = onlineStoresOnly();
  if (!online && !regionFilterEnabled()) {
    return capStoresWithoutRegion(files, maxStores);
  }

  const allowed = online
    ? allowedStoreCodesForOnline(storeLocations)
    : allowedStoreCodesFromLocations(storeLocations, normalizeStoreCode);

  if (allowed.size === 0) {
    console.warn(
      online
        ? "Online filter: this chain publishes no orderable storefront (StoreType 2 or a " +
            "delivery/pickup name). Only its Stores file will be ingested. " +
            "Set SUPER_MCP_ONLINE_STORES_ONLY=0 to ingest branches too."
        : "Region filter: no stores matched coverage (Gush Dan/Sharon, Jerusalem, Haifa, Beersheva). " +
            "Only Stores files will be ingested. Set SUPER_MCP_REGION_FILTER=0 to disable.",
    );
  }

  const out: FeedFile[] = [];

  // Stores files first (always). This is the one file we can never skip: it is
  // where the next run learns which store codes are orderable, so dropping it
  // would make the filter permanently blind to a chain that opens a storefront.
  for (const f of files) {
    if (f.kind === "stores") out.push(f);
  }

  for (const kind of ["pricesfull", "promosfull"] as const) {
    const seen = new Set<string>();
    for (const f of files) {
      if (f.kind !== kind) continue;
      const code = f.storeId ? normalizeStoreCode(f.storeId) : "";
      if (!code || code === "unknown") continue;
      if (allowed.size > 0 && !allowed.has(code)) continue;
      if (allowed.size === 0) continue; // strict: no prices without a matched store
      if (seen.has(code)) continue;
      if (seen.size >= maxStores) continue;
      seen.add(code);
      out.push(f);
    }
  }

  return out;
}

/** Store codes whose Stores-file record describes a place an order can reach. */
function allowedStoreCodesForOnline(stores: StoreLocationHint[]): Set<string> {
  const allowed = new Set<string>();
  for (const s of stores) {
    if (!isOrderableStorefront(s)) continue;
    const code = normalizeStoreCode(s.storeId);
    if (code && code !== "unknown") allowed.add(code);
  }
  return allowed;
}

function capStoresWithoutRegion(files: FeedFile[], maxStores: number): FeedFile[] {
  const out: FeedFile[] = [];
  for (const f of files) {
    if (f.kind === "stores") out.push(f);
  }
  for (const kind of ["pricesfull", "promosfull"] as const) {
    const seen = new Set<string>();
    for (const f of files) {
      if (f.kind !== kind) continue;
      const code = f.storeId ? normalizeStoreCode(f.storeId) : "";
      if (!code || seen.has(code)) continue;
      if (seen.size >= maxStores) continue;
      seen.add(code);
      out.push(f);
    }
  }
  return out;
}
