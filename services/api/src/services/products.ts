import { query } from "@super-mcp/db";
import { applyPromoToUnitPrice, type FreshnessMeta } from "@super-mcp/shared";
import { getActivePromotionsForListings, pickPromoForStore } from "./promotions.js";
import { haversineKmSql, type GeoPoint } from "../lib/geo.js";

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

interface ProductRow {
  id: string;
  gtin: string | null;
  name: string;
  brand: string | null;
  category_l1: string | null;
  category_l2: string | null;
  size_qty: number | null;
  size_unit: string | null;
}

function mapProduct(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    gtin: row.gtin,
    name: row.name,
    brand: row.brand,
    categoryL1: row.category_l1,
    categoryL2: row.category_l2,
    sizeQty: row.size_qty,
    sizeUnit: row.size_unit,
  };
}

export interface SearchProductsParams {
  q?: string;
  category?: string;
  brand?: string;
  gtin?: string;
  limit?: number;
}

/** Hebrew/English search: tsvector (simple config) for tokenized matches + pg_trgm for fuzzy/typo tolerance. */
export async function searchProducts(params: SearchProductsParams): Promise<ProductSummary[]> {
  const q = (params.q ?? "").trim();
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20;
  const res = await query<ProductRow>(
    `SELECT p.id, p.gtin, p.name, p.brand, p.category_l1, p.category_l2, p.size_qty, p.size_unit
     FROM product p
     WHERE ($1 = '' OR p.search_vector @@ websearch_to_tsquery('simple', $1)
            OR p.name % $1 OR p.name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR p.category_l1 = $2 OR p.category_l2 = $2)
       AND ($3::text IS NULL OR p.brand ILIKE '%' || $3 || '%')
       AND ($4::text IS NULL OR p.gtin = $4)
     ORDER BY
       -- Prefer products that actually have current prices in at least one store
       (EXISTS (
          SELECT 1 FROM listing l
          JOIN store_price sp ON sp.listing_id = l.id
          WHERE l.product_id = p.id
       )) DESC,
       (CASE WHEN $1 <> '' AND p.name ILIKE $1 || '%' THEN 2
             WHEN $1 <> '' AND p.name ILIKE '%' || $1 || '%' THEN 1
             ELSE 0 END) DESC,
       (CASE WHEN $1 = '' THEN 0 ELSE similarity(p.name, $1) END) DESC,
       (SELECT count(*) FROM listing l WHERE l.product_id = p.id) DESC,
       p.name ASC
     LIMIT $5`,
    [q, params.category ?? null, params.brand ?? null, params.gtin ?? null, limit],
  );
  return res.rows.map(mapProduct);
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

interface ListingRow {
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

/** Fetches a canonical product by UUID, including per-chain listings. */
export async function getProductById(id: string): Promise<ProductDetail | null> {
  const productRes = await query<ProductRow>(
    `SELECT id, gtin, name, brand, category_l1, category_l2, size_qty, size_unit FROM product WHERE id = $1`,
    [id],
  );
  const row = productRes.rows[0];
  if (!row) return null;

  const listingsRes = await query<ListingRow>(
    `SELECT l.id, l.chain_id, c.name_he AS chain_name, l.item_code, l.name, l.brand,
            l.qty, l.unit, l.canonical_qty, l.canonical_unit, l.measure_unparseable
     FROM listing l
     JOIN chain c ON c.id = l.chain_id
     WHERE l.product_id = $1
     ORDER BY c.name_he ASC`,
    [id],
  );

  return {
    ...mapProduct(row),
    listings: listingsRes.rows.map((l) => ({
      id: l.id,
      chainId: l.chain_id,
      chainName: l.chain_name,
      itemCode: l.item_code,
      name: l.name,
      brand: l.brand,
      qty: l.qty,
      unit: l.unit,
      canonicalQty: l.canonical_qty,
      canonicalUnit: l.canonical_unit,
      measureUnparseable: l.measure_unparseable,
    })),
  };
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
  unitPrice: number | null;
  currency: string;
  effectivePrice: number;
  promoApplied: boolean;
  promoDescription: string | null;
  freshness: Freshness;
}

interface PriceQueryRow {
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
  price: string;
  unit_price: string | null;
  currency: string;
  source_ts: string;
  ingested_at: string;
}

export interface GetProductPricesParams {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  includeClub?: boolean;
}

export async function getProductPrices(
  productId: string,
  opts: GetProductPricesParams,
): Promise<ProductPriceRow[]> {
  const params: unknown[] = [productId];
  let distanceSelect = "NULL::double precision AS distance_km";
  const conditions: string[] = [];

  if (opts.city) {
    params.push(opts.city);
    conditions.push(`st.city = $${params.length}`);
  }
  if (opts.near) {
    params.push(opts.near.lat, opts.near.lng);
    const latIdx = params.length - 1;
    const lngIdx = params.length;
    const distanceExpr = haversineKmSql(latIdx, lngIdx, "st.lat", "st.lng");
    distanceSelect = `${distanceExpr} AS distance_km`;
    if (opts.radiusKm != null) {
      params.push(opts.radiusKm);
      conditions.push(`st.lat IS NOT NULL AND st.lng IS NOT NULL AND ${distanceExpr} <= $${params.length}`);
    }
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
  const orderBy = opts.near ? "distance_km ASC, sp.price ASC" : "sp.price ASC";

  const res = await query<PriceQueryRow>(
    `SELECT
       st.id AS store_id, st.name AS store_name, st.chain_id, c.name_he AS chain_name,
       st.city, st.address, st.lat, st.lng, ${distanceSelect},
       l.id AS listing_id, l.item_code,
       sp.price, sp.unit_price, sp.currency, sp.source_ts, sp.ingested_at
     FROM listing l
     JOIN store_price sp ON sp.listing_id = l.id
     JOIN store st ON st.id = sp.store_id
     JOIN chain c ON c.id = st.chain_id
     WHERE l.product_id = $1
       ${whereClause}
     ORDER BY ${orderBy}
     LIMIT 500`,
    params,
  );

  if (res.rows.length === 0) return [];

  const listingIds = [...new Set(res.rows.map((r) => r.listing_id))];
  const promoMap = await getActivePromotionsForListings(listingIds, opts.includeClub ?? true);

  return res.rows.map((r) => {
    const listPrice = Number(r.price);
    const promo = pickPromoForStore(promoMap.get(r.listing_id), r.store_id, r.chain_id);
    let effectivePrice = listPrice;
    let promoApplied = false;
    let promoDescription: string | null = null;

    if (promo) {
      const applied = applyPromoToUnitPrice(listPrice, 1, promo.mechanic);
      // Never let a misparsed mechanic raise the price above the unpromoted total.
      if (applied.applied && applied.effectiveTotal < listPrice * 1) {
        effectivePrice = Math.round(applied.effectiveTotal * 100) / 100;
        promoApplied = true;
        promoDescription = promo.description;
      }
    }

    return {
      storeId: r.store_id,
      storeName: r.store_name,
      chainId: r.chain_id,
      chainName: r.chain_name,
      city: r.city,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      listingId: r.listing_id,
      itemCode: r.item_code,
      listPrice,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      currency: r.currency,
      effectivePrice,
      promoApplied,
      promoDescription,
      freshness: { sourceTs: r.source_ts, ingestedAt: r.ingested_at },
    };
  });
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

interface HistoryRow {
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

export async function getProductHistory(
  productId: string,
  opts: GetProductHistoryParams,
): Promise<ProductHistoryPoint[]> {
  const params: unknown[] = [productId];
  const conditions: string[] = [];

  if (opts.store_id) {
    params.push(opts.store_id);
    conditions.push(`pp.store_id = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    conditions.push(`pp.source_ts >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    conditions.push(`pp.source_ts <= $${params.length}`);
  }
  const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const res = await query<HistoryRow>(
    `SELECT pp.store_id, st.name AS store_name, st.chain_id, pp.price, pp.unit_price, pp.currency, pp.source_ts
     FROM price_point pp
     JOIN listing l ON l.id = pp.listing_id
     JOIN store st ON st.id = pp.store_id
     WHERE l.product_id = $1
       ${whereClause}
     ORDER BY pp.source_ts ASC
     LIMIT 5000`,
    params,
  );

  return res.rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    chainId: r.chain_id,
    price: Number(r.price),
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    currency: r.currency,
    sourceTs: r.source_ts,
  }));
}
