import { query } from "@super-mcp/db";
import { applyPromoToUnitPrice, cityMatchKeys, displayCity } from "@super-mcp/shared";
import { geoBoundingBoxSql, haversineKmSql } from "../../lib/geo.js";
import { resolveRadiusKm } from "../../lib/defaults.js";
import { getActivePromotionsForListings, pickPromoForStore } from "../promotions/index.js";
import { buildProductLink } from "../productLinks/index.js";
import type {
  GetProductPricesParams,
  PriceQueryRow,
  PriceSortBy,
  ProductPriceRow,
} from "./types.js";

function unitBasisFromSize(sizeUnit: string | null): ProductPriceRow["unitBasis"] {
  if (sizeUnit === "g") return "per_100g";
  if (sizeUnit === "ml") return "per_100ml";
  if (sizeUnit === "unit") return "per_unit";
  return "unknown";
}

export async function getProductPrices(
  productId: string,
  opts: GetProductPricesParams,
): Promise<ProductPriceRow[]> {
  const params: unknown[] = [productId];
  let distanceSelect = "NULL::double precision AS distance_km";
  const conditions: string[] = [];
  const sortBy: PriceSortBy = opts.sortBy === "unit_price" ? "unit_price" : "price";

  if (opts.city) {
    params.push(cityMatchKeys(opts.city));
    conditions.push(`st.city = ANY($${params.length}::text[])`);
  }
  if (opts.near) {
    params.push(opts.near.lat, opts.near.lng);
    const latIdx = params.length - 1;
    const lngIdx = params.length;
    const distanceExpr = haversineKmSql(latIdx, lngIdx, "st.lat", "st.lng");
    distanceSelect = `${distanceExpr} AS distance_km`;
    const radiusKm = resolveRadiusKm(opts.near, opts.radiusKm);
    if (radiusKm != null) {
      params.push(radiusKm);
      const radiusIdx = params.length;
      conditions.push(geoBoundingBoxSql(latIdx, lngIdx, radiusIdx, "st.lat", "st.lng"));
      conditions.push(`${distanceExpr} <= $${radiusIdx}`);
    }
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
  const orderBy =
    sortBy === "unit_price"
      ? "sp.unit_price ASC NULLS LAST, sp.price ASC"
      : "sp.price ASC";

  const res = await query<PriceQueryRow>(
    `SELECT
       st.id AS store_id, st.name AS store_name, st.chain_id, c.name_he AS chain_name,
       st.city, st.address, st.lat, st.lng, ${distanceSelect},
       l.id AS listing_id, l.item_code, l.name AS listing_name, p.gtin,
       sp.price, sp.unit_price, sp.currency, sp.source_ts, sp.ingested_at,
       p.size_unit
     FROM listing l
     JOIN product p ON p.id = l.product_id
     JOIN store_price sp ON sp.listing_id = l.id
     JOIN store st ON st.id = sp.store_id
     JOIN chain c ON c.id = st.chain_id
     WHERE l.product_id = $1
       AND sp.price > 0
       ${whereClause}
     ORDER BY ${orderBy}
     LIMIT 500`,
    params,
  );

  if (res.rows.length === 0) return [];

  const listingIds = [...new Set(res.rows.map((r) => r.listing_id))];
  const promoMap = await getActivePromotionsForListings(listingIds, opts.includeClub ?? true);

  const mapped = res.rows.map((r) => {
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
      city: displayCity(r.city),
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      listingId: r.listing_id,
      itemCode: r.item_code,
      listPrice,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      unitBasis: unitBasisFromSize(r.size_unit),
      currency: r.currency,
      effectivePrice,
      promoApplied,
      promoDescription,
      link: buildProductLink({ chainId: r.chain_id, gtin: r.gtin, name: r.listing_name }).url,
      freshness: { sourceTs: r.source_ts, ingestedAt: r.ingested_at },
    };
  });

  // SQL orders by list/unit price; promos are applied afterward. Re-rank so
  // "cheapest first" is what the customer pays (or unit price when requested).
  // Within a radius, price wins over distance (distance stays on each row).
  mapped.sort((a, b) => {
    if (sortBy === "unit_price") {
      const ua = a.unitPrice ?? Infinity;
      const ub = b.unitPrice ?? Infinity;
      if (ua !== ub) return ua - ub;
    }
    if (a.effectivePrice !== b.effectivePrice) return a.effectivePrice - b.effectivePrice;
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    return da - db;
  });

  return mapped;
}
