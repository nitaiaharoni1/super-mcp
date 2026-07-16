import { query } from "@super-mcp/db";
import { applyPromoToUnitPrice, AppError } from "@super-mcp/shared";
import { searchProducts, type Freshness } from "./products.js";
import { listStores } from "./stores.js";
import { getActivePromotionsForListings, pickPromoForStore } from "./promotions.js";
import type { GeoPoint } from "../lib/geo.js";

export interface BasketItemInput {
  productId?: string;
  gtin?: string;
  query?: string;
  qty: number;
}

export interface BasketOptimizeInput {
  items: BasketItemInput[];
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  includeClub?: boolean;
}

type ResolvedBy = "product_id" | "gtin" | "query" | "unresolved";

interface ResolvedItem {
  index: number;
  qty: number;
  productId: string | null;
  name: string | null;
  resolvedBy: ResolvedBy;
}

export interface BasketItemStatus {
  index: number;
  qty: number;
  productId: string | null;
  name: string | null;
  resolved: boolean;
  resolvedBy: ResolvedBy;
}

export interface BasketLine {
  itemIndex: number;
  productId: string;
  name: string;
  qty: number;
  listingId: string;
  itemCode: string;
  unitPrice: number;
  lineTotal: number;
  promoApplied: boolean;
  promoDescription: string | null;
  freshness: Freshness;
}

export interface BasketMissingItem {
  itemIndex: number;
  productId: string | null;
  name: string | null;
  reason: "product_not_found" | "not_carried_by_chain" | "no_price_data";
}

export interface BasketStoreResult {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  city: string | null;
  address: string | null;
  distanceKm: number | null;
  currency: string;
  total: number;
  itemsFound: number;
  itemsRequested: number;
  lines: BasketLine[];
  missingItems: BasketMissingItem[];
}

export interface BasketOptimizeResult {
  items: BasketItemStatus[];
  stores: BasketStoreResult[];
}

async function resolveItems(items: BasketItemInput[]): Promise<ResolvedItem[]> {
  const resolved: ResolvedItem[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      throw new AppError("bad_request", `items[${index}].qty must be a positive number`, 400);
    }

    if (item.productId) {
      const res = await query<{ id: string; name: string }>(`SELECT id, name FROM product WHERE id = $1`, [
        item.productId,
      ]);
      const row = res.rows[0];
      resolved.push({
        index,
        qty: item.qty,
        productId: row?.id ?? null,
        name: row?.name ?? null,
        resolvedBy: row ? "product_id" : "unresolved",
      });
      continue;
    }

    if (item.gtin) {
      const rows = await searchProducts({ q: "", gtin: item.gtin, limit: 1 });
      const p = rows[0];
      resolved.push({
        index,
        qty: item.qty,
        productId: p?.id ?? null,
        name: p?.name ?? null,
        resolvedBy: p ? "gtin" : "unresolved",
      });
      continue;
    }

    if (item.query) {
      const rows = await searchProducts({ q: item.query, limit: 1 });
      const p = rows[0];
      resolved.push({
        index,
        qty: item.qty,
        productId: p?.id ?? null,
        name: p?.name ?? item.query,
        resolvedBy: p ? "query" : "unresolved",
      });
      continue;
    }

    throw new AppError("bad_request", `items[${index}] must include one of product_id, gtin, or query`, 400);
  }

  return resolved;
}

interface ListingRow {
  id: string;
  product_id: string;
  chain_id: string;
  item_code: string;
  name: string;
}

interface StorePriceRow {
  listing_id: string;
  store_id: string;
  price: string;
  currency: string;
  source_ts: string;
  ingested_at: string;
}

export async function optimizeBasket(input: BasketOptimizeInput): Promise<BasketOptimizeResult> {
  if (input.items.length === 0) {
    throw new AppError("bad_request", "items must contain at least one entry", 400);
  }

  const resolvedItems = await resolveItems(input.items);
  const itemStatuses: BasketItemStatus[] = resolvedItems.map((r) => ({
    index: r.index,
    qty: r.qty,
    productId: r.productId,
    name: r.name,
    resolved: r.productId !== null,
    resolvedBy: r.resolvedBy,
  }));

  const productIds = [...new Set(resolvedItems.map((r) => r.productId).filter((id): id is string => id !== null))];

  const candidateStores = await listStores({
    city: input.city,
    near: input.near,
    radiusKm: input.radiusKm,
  });

  if (productIds.length === 0 || candidateStores.length === 0) {
    return { items: itemStatuses, stores: [] };
  }

  const storeIds = candidateStores.map((s) => s.id);

  const listingRes = await query<ListingRow>(
    `SELECT id, product_id, chain_id, item_code, name FROM listing WHERE product_id = ANY($1::uuid[])`,
    [productIds],
  );
  // Map of (chainId -> productId -> listing) for O(1) lookup while iterating stores.
  const listingByChainAndProduct = new Map<string, Map<string, ListingRow>>();
  for (const listing of listingRes.rows) {
    const byProduct = listingByChainAndProduct.get(listing.chain_id) ?? new Map<string, ListingRow>();
    byProduct.set(listing.product_id, listing);
    listingByChainAndProduct.set(listing.chain_id, byProduct);
  }

  const listingIds = listingRes.rows.map((l) => l.id);
  const priceRes =
    listingIds.length > 0
      ? await query<StorePriceRow>(
          `SELECT listing_id, store_id, price, currency, source_ts, ingested_at
           FROM store_price
           WHERE listing_id = ANY($1::uuid[]) AND store_id = ANY($2::uuid[])`,
          [listingIds, storeIds],
        )
      : { rows: [] as StorePriceRow[] };
  const priceByListingAndStore = new Map<string, StorePriceRow>();
  for (const row of priceRes.rows) {
    priceByListingAndStore.set(`${row.listing_id}:${row.store_id}`, row);
  }

  const includeClub = input.includeClub ?? true;
  const promoMap = await getActivePromotionsForListings(listingIds, includeClub);

  const storeResults: BasketStoreResult[] = [];

  for (const store of candidateStores) {
    const lines: BasketLine[] = [];
    const missingItems: BasketMissingItem[] = [];
    const byProduct = listingByChainAndProduct.get(store.chainId);

    for (const item of resolvedItems) {
      if (!item.productId) {
        missingItems.push({
          itemIndex: item.index,
          productId: null,
          name: item.name,
          reason: "product_not_found",
        });
        continue;
      }

      const listing = byProduct?.get(item.productId);
      if (!listing) {
        missingItems.push({
          itemIndex: item.index,
          productId: item.productId,
          name: item.name,
          reason: "not_carried_by_chain",
        });
        continue;
      }

      const priceRow = priceByListingAndStore.get(`${listing.id}:${store.id}`);
      if (!priceRow) {
        missingItems.push({
          itemIndex: item.index,
          productId: item.productId,
          name: item.name,
          reason: "no_price_data",
        });
        continue;
      }

      const listPrice = Number(priceRow.price);
      const promo = pickPromoForStore(promoMap.get(listing.id), store.id, store.chainId);
      let lineTotal = listPrice * item.qty;
      let promoApplied = false;
      let promoDescription: string | null = null;

      if (promo) {
        const applied = applyPromoToUnitPrice(listPrice, item.qty, promo.mechanic);
        // Only apply a promo if it actually reduces the total; never let a misparsed mechanic
        // increase the customer's price.
        if (applied.applied && applied.effectiveTotal < listPrice * item.qty) {
          lineTotal = Math.round(applied.effectiveTotal * 100) / 100;
          promoApplied = true;
          promoDescription = promo.description;
        }
      }

      lines.push({
        itemIndex: item.index,
        productId: item.productId,
        name: item.name ?? listing.name,
        qty: item.qty,
        listingId: listing.id,
        itemCode: listing.item_code,
        unitPrice: listPrice,
        lineTotal,
        promoApplied,
        promoDescription,
        freshness: { sourceTs: priceRow.source_ts, ingestedAt: priceRow.ingested_at },
      });
    }

    if (lines.length === 0) continue;

    const total = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
    const currency = priceRes.rows.find((r) => r.listing_id === lines[0]!.listingId)?.currency ?? "ILS";

    storeResults.push({
      storeId: store.id,
      storeName: store.name,
      chainId: store.chainId,
      chainName: store.chainName,
      city: store.city,
      address: store.address,
      distanceKm: store.distanceKm,
      currency,
      total,
      itemsFound: lines.length,
      itemsRequested: resolvedItems.length,
      lines,
      missingItems,
    });
  }

  storeResults.sort((a, b) => {
    const missingDiff = a.missingItems.length - b.missingItems.length;
    if (missingDiff !== 0) return missingDiff;
    return a.total - b.total;
  });

  return { items: itemStatuses, stores: storeResults };
}
