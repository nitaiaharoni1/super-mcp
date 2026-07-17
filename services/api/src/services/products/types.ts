import type { FreshnessMeta } from "@super-mcp/shared";
import type { GeoPoint } from "../../lib/geo.js";

export type Freshness = FreshnessMeta;

export interface ProductSummary {
  id: string;
  gtin: string | null;
  name: string;
  brand: string | null;
  categoryL1: string | null;
  categoryL2: string | null;
  sizeQty: number | null;
  sizeUnit: string | null;
}

export interface ProductRow {
  id: string;
  gtin: string | null;
  name: string;
  brand: string | null;
  category_l1: string | null;
  category_l2: string | null;
  size_qty: number | null;
  size_unit: string | null;
}

export interface ProductListing {
  id: string;
  chainId: string;
  chainName: string;
  itemCode: string;
  name: string;
  brand: string | null;
  qty: number | null;
  unit: string | null;
  canonicalQty: number | null;
  canonicalUnit: string | null;
  measureUnparseable: boolean;
}

export interface ProductDetail extends ProductSummary {
  listings: ProductListing[];
}

export interface ListingRow {
  id: string;
  chain_id: string;
  chain_name: string;
  item_code: string;
  name: string;
  brand: string | null;
  qty: number | null;
  unit: string | null;
  canonical_qty: number | null;
  canonical_unit: string | null;
  measure_unparseable: boolean;
}

export interface ProductPriceRow {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  listingId: string;
  itemCode: string;
  listPrice: number;
  /** ₪ per 100g, 100ml, or per unit (from ingestion). Null if package size was unparseable. */
  unitPrice: number | null;
  unitBasis: "per_100g" | "per_100ml" | "per_unit" | "unknown";
  currency: string;
  effectivePrice: number;
  promoApplied: boolean;
  promoDescription: string | null;
  /** Clickable link to open this product on the chain's storefront (search-by-barcode/name). Null if the chain has no online store. */
  link: string | null;
  freshness: Freshness;
}

export interface PriceQueryRow {
  store_id: string;
  store_name: string;
  chain_id: string;
  chain_name: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  listing_id: string;
  item_code: string;
  listing_name: string;
  gtin: string | null;
  price: string;
  unit_price: string | null;
  currency: string;
  source_ts: string;
  ingested_at: string;
  size_unit: string | null;
}

export type PriceSortBy = "price" | "unit_price";

export interface GetProductPricesParams {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  includeClub?: boolean;
  /** `price` = cheapest shelf/effective total; `unit_price` = cheaper per 100g/100ml/unit. */
  sortBy?: PriceSortBy;
}

export interface ProductHistoryPoint {
  storeId: string;
  storeName: string;
  chainId: string;
  price: number;
  unitPrice: number | null;
  currency: string;
  sourceTs: string;
}

export interface HistoryRow {
  store_id: string;
  store_name: string;
  chain_id: string;
  price: string;
  unit_price: string | null;
  currency: string;
  source_ts: string;
}

export interface GetProductHistoryParams {
  store_id?: string;
  from?: Date;
  to?: Date;
}
