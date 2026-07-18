import { query } from "@super-mcp/db";
import { AppError } from "@super-mcp/shared";
import type { GeoPoint } from "../../lib/geo.js";
import { storeLocationAndClause, storeLocationSql } from "../../lib/storeLocationSql.js";
import { getProductById, type ProductSummary } from "../products/index.js";

export interface SuggestSubstitutesParams {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  /** Max substitutes to return. Default 10. */
  limit?: number;
  /**
   * If true (default), only return products with a cheaper unit price
   * (₪ per 100g / 100ml / unit) than the baseline product in the same area.
   */
  cheaperOnly?: boolean;
}

export interface SubstituteOffer {
  product: ProductSummary;
  /** Best observed unit price in the scoped stores (₪ per 100g/100ml/unit). */
  bestUnitPrice: number;
  unitBasis: "per_100g" | "per_100ml" | "per_unit" | "unknown";
  currency: string;
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  distanceKm: number | null;
  /** How much cheaper per canonical unit vs the baseline (positive = savings). */
  unitPriceSaving: number | null;
  /** Rough similarity hint for agents. */
  matchReason: "same_category" | "similar_name" | "same_category_and_name";
}

export interface SuggestSubstitutesResult {
  product: ProductSummary;
  baseline: {
    bestUnitPrice: number | null;
    unitBasis: SubstituteOffer["unitBasis"];
    currency: string;
    storeId: string | null;
    storeName: string | null;
  };
  substitutes: SubstituteOffer[];
}

interface BaselineRow {
  unit_price: string;
  currency: string;
  store_id: string;
  store_name: string;
  size_unit: string | null;
}

interface CandidateRow {
  id: string;
  gtin: string | null;
  name: string;
  brand: string | null;
  category_l1: string | null;
  category_l2: string | null;
  size_qty: number | null;
  size_unit: string | null;
  unit_price: string;
  currency: string;
  store_id: string;
  store_name: string;
  chain_id: string;
  chain_name: string;
  distance_km: number | null;
  name_sim: number;
  same_category: boolean;
}

function unitBasis(sizeUnit: string | null | undefined): SubstituteOffer["unitBasis"] {
  if (sizeUnit === "g") return "per_100g";
  if (sizeUnit === "ml") return "per_100ml";
  if (sizeUnit === "unit") return "per_unit";
  return "unknown";
}

function matchReason(sameCategory: boolean, nameSim: number): SubstituteOffer["matchReason"] {
  if (sameCategory && nameSim >= 0.2) return "same_category_and_name";
  if (sameCategory) return "same_category";
  return "similar_name";
}

/**
 * Suggest similar products that are cheaper per 100g / 100ml / unit in the area.
 * Similarity = same category and/or trigram-similar Hebrew/English name.
 */
export async function suggestSubstitutes(
  productId: string,
  opts: SuggestSubstitutesParams,
): Promise<SuggestSubstitutesResult> {
  const product = await getProductById(productId);
  if (!product) {
    throw new AppError("not_found", "Product not found", 404, { id: productId });
  }

  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 50) : 10;
  const cheaperOnly = opts.cheaperOnly ?? true;

  const baseParams: unknown[] = [productId];
  const baseLoc = storeLocationAndClause(storeLocationSql(opts, baseParams));

  const baselineRes = await query<BaselineRow>(
    `SELECT sp.unit_price, sp.currency, st.id AS store_id, st.name AS store_name, p.size_unit
     FROM listing l
     JOIN store_price sp ON sp.listing_id = l.id
     JOIN store st ON st.id = sp.store_id
     JOIN product p ON p.id = l.product_id
     WHERE l.product_id = $1
       AND sp.price > 0
       AND sp.unit_price IS NOT NULL
       AND sp.unit_price > 0
       ${baseLoc}
     ORDER BY sp.unit_price ASC
     LIMIT 1`,
    baseParams,
  );

  const baselineRow = baselineRes.rows[0];
  const baselineUnitPrice = baselineRow ? Number(baselineRow.unit_price) : null;
  const baselineBasis = unitBasis(baselineRow?.size_unit ?? product.sizeUnit);

  const params: unknown[] = [
    productId,
    product.name,
    product.categoryL1,
    product.categoryL2,
    product.sizeUnit,
  ];
  const loc = storeLocationSql(opts, params);
  params.push(limit * 8);
  const limitIdx = params.length;

  const res = await query<CandidateRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (p.id)
         p.id, p.gtin, p.name, p.brand, p.category_l1, p.category_l2, p.size_qty, p.size_unit,
         sp.unit_price, sp.currency, st.id AS store_id, st.name AS store_name,
         st.chain_id, c.name_he AS chain_name, ${loc.distanceSelect},
         similarity(p.name, $2) AS name_sim,
         ( ($3::text IS NOT NULL AND p.category_l1 = $3)
           OR ($4::text IS NOT NULL AND p.category_l2 = $4) ) AS same_category
       FROM product p
       JOIN listing l ON l.product_id = p.id
       JOIN store_price sp ON sp.listing_id = l.id
       JOIN store st ON st.id = sp.store_id
       JOIN chain c ON c.id = st.chain_id
       WHERE p.id <> $1
         AND sp.price > 0
         AND sp.unit_price IS NOT NULL
         AND sp.unit_price > 0
         AND (
           ($3::text IS NOT NULL AND p.category_l1 = $3)
           OR ($4::text IS NOT NULL AND p.category_l2 = $4)
           OR p.name % $2
           OR ($2 <> '' AND p.name ILIKE '%' || split_part($2, ' ', 1) || '%')
         )
         AND ($5::text IS NULL OR p.size_unit = $5)
         ${storeLocationAndClause(loc)}
       ORDER BY p.id, sp.unit_price ASC
     ) c
     ORDER BY c.same_category DESC, c.name_sim DESC, c.unit_price ASC
     LIMIT $${limitIdx}`,
    params,
  );

  let substitutes: SubstituteOffer[] = res.rows.map((r) => {
    const bestUnitPrice = Number(r.unit_price);
    return {
      product: {
        id: r.id,
        gtin: r.gtin,
        name: r.name,
        brand: r.brand,
        categoryL1: r.category_l1,
        categoryL2: r.category_l2,
        sizeQty: r.size_qty,
        sizeUnit: r.size_unit,
      },
      bestUnitPrice,
      unitBasis: unitBasis(r.size_unit),
      currency: r.currency,
      storeId: r.store_id,
      storeName: r.store_name,
      chainId: r.chain_id,
      chainName: r.chain_name,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      unitPriceSaving:
        baselineUnitPrice != null
          ? Math.round((baselineUnitPrice - bestUnitPrice) * 100) / 100
          : null,
      matchReason: matchReason(Boolean(r.same_category), Number(r.name_sim) || 0),
    };
  });

  // When the baseline has a known unit basis, drop unknown-basis candidates so we
  // never rank ₪/unit against ₪/100g as if they were comparable.
  if (baselineBasis !== "unknown") {
    substitutes = substitutes.filter((s) => s.unitBasis === baselineBasis);
  }

  if (cheaperOnly && baselineUnitPrice != null) {
    substitutes = substitutes.filter((s) => s.bestUnitPrice < baselineUnitPrice);
  }

  substitutes.sort((a, b) => a.bestUnitPrice - b.bestUnitPrice);
  substitutes = substitutes.slice(0, limit);

  return {
    product: {
      id: product.id,
      gtin: product.gtin,
      name: product.name,
      brand: product.brand,
      categoryL1: product.categoryL1,
      categoryL2: product.categoryL2,
      sizeQty: product.sizeQty,
      sizeUnit: product.sizeUnit,
    },
    baseline: {
      bestUnitPrice: baselineUnitPrice,
      unitBasis: baselineBasis,
      currency: baselineRow?.currency ?? "ILS",
      storeId: baselineRow?.store_id ?? null,
      storeName: baselineRow?.store_name ?? null,
    },
    substitutes,
  };
}
