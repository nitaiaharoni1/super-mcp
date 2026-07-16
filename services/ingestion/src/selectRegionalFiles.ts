import type { FeedFile } from "@super-mcp/shared";
import {
  allowedStoreCodesFromLocations,
  regionFilterEnabled,
  type StoreLocationHint,
} from "./regions.js";
import { normalizeStoreCode } from "./storeCode.js";

/**
 * Keep Stores files always; keep PriceFull/PromoFull only for stores in the
 * ingest region, capped at maxStores distinct store codes per kind.
 */
export function selectRegionalFeedFiles(
  files: FeedFile[],
  storeLocations: StoreLocationHint[],
  maxStores: number,
): FeedFile[] {
  if (!regionFilterEnabled()) {
    return capStoresWithoutRegion(files, maxStores);
  }

  const allowed = allowedStoreCodesFromLocations(storeLocations, normalizeStoreCode);
  if (allowed.size === 0) {
    console.warn(
      "Region filter: no stores matched coverage (Gush Dan/Sharon, Jerusalem, Haifa, Beersheva). " +
        "Only Stores files will be ingested. Set SUPER_MCP_REGION_FILTER=0 to disable.",
    );
  }

  const out: FeedFile[] = [];
  const seenByKind = new Map<string, Set<string>>();

  // Stores files first (always).
  for (const f of files) {
    if (f.kind === "stores") out.push(f);
  }

  for (const kind of ["pricesfull", "promosfull"] as const) {
    const seen = new Set<string>();
    seenByKind.set(kind, seen);
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
