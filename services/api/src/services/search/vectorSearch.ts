import { query } from "@super-mcp/db";
import { cityMatchKeys, formatVectorLiteral, normalizeGtin } from "@super-mcp/shared";
import { resolveRadiusKm } from "../../lib/defaults.js";
import { mapProduct } from "../products/mapProduct.js";
import { buildPriceExistsSql, escapeIlike } from "./sqlUtils.js";
import type { SearchHitRow, SearchProductHit, SearchProductsParams } from "./types.js";

export interface SearchByQueryVectorInput {
  vector: number[];
  model: string;
  limit: number;
  maxDistance: number;
  /** Optional filters / location from the parent search request. */
  params?: Pick<
    SearchProductsParams,
    "category" | "brand" | "gtin" | "city" | "near" | "radiusKm" | "storeIds" | "inStockOnly"
  >;
}

function scoreFromDistance(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}

/**
 * Direct ANN recall against product_embedding for a query vector.
 * No lexical anchor required.
 */
export async function searchByQueryVector(
  input: SearchByQueryVectorInput,
): Promise<SearchProductHit[]> {
  const limit = Math.max(1, Math.min(input.limit, 200));
  const literal = formatVectorLiteral(input.vector);
  const p = input.params ?? {};
  const gtin = p.gtin?.trim() ? normalizeGtin(p.gtin.trim()) : null;
  const brandLike = p.brand ? escapeIlike(p.brand) : null;
  const radius = resolveRadiusKm(p.near, p.radiusKm);
  const scoped = Boolean(p.city || p.near || (p.storeIds && p.storeIds.length > 0));

  // Fixed params: $1 vector, $2 model, $3 maxDistance, $4 limit, $5 category, $6 brand, $7 gtin
  const sqlParams: unknown[] = [
    literal,
    input.model,
    input.maxDistance,
    limit,
    p.category ?? null,
    brandLike,
    gtin,
  ];

  let cityParam: number | undefined;
  let nearLatParam: number | undefined;
  let nearLngParam: number | undefined;
  let radiusParam: number | undefined;
  let storeIdsParam: number | undefined;

  if (p.storeIds && p.storeIds.length > 0) {
    sqlParams.push(p.storeIds);
    storeIdsParam = sqlParams.length;
  }
  if (p.city) {
    sqlParams.push(cityMatchKeys(p.city));
    cityParam = sqlParams.length;
  }
  if (p.near && radius != null) {
    sqlParams.push(p.near.lat, p.near.lng, radius);
    nearLatParam = sqlParams.length - 2;
    nearLngParam = sqlParams.length - 1;
    radiusParam = sqlParams.length;
  }

  const localExists = buildPriceExistsSql("p.id", {
    scoped,
    cityParam,
    nearLatParam,
    nearLngParam,
    radiusParam,
    storeIdsParam,
  });
  const globalExists = buildPriceExistsSql("p.id", { scoped: false });
  const stockFilter = p.inStockOnly && scoped ? `AND ${localExists}` : "";

  const sql = `
    SELECT p.id, p.gtin, p.name, p.brand, p.category_l1, p.category_l2, p.size_qty, p.size_unit,
           (pe.embedding <=> $1::vector) AS vector_distance,
           ${globalExists} AS has_price,
           ${scoped ? localExists : globalExists} AS has_local_price
    FROM product_embedding pe
    JOIN product p ON p.id = pe.product_id
    WHERE pe.model = $2
      AND pe.embedding <=> $1::vector <= $3
      AND ($5::text IS NULL OR p.category_l1 = $5 OR p.category_l2 = $5)
      AND ($6::text IS NULL OR p.brand ILIKE '%' || $6 || '%' ESCAPE '\\')
      AND ($7::text IS NULL OR p.gtin = $7)
      ${stockFilter}
    ORDER BY pe.embedding <=> $1::vector
    LIMIT $4`;

  const res = await query<SearchHitRow & { vector_distance: string | number }>(sql, sqlParams);

  return res.rows.map((row) => {
    const distance = Number(row.vector_distance);
    return {
      ...mapProduct(row),
      score: scoreFromDistance(distance),
      matchedVia: "vector" as const,
      hasPrice: row.has_price,
      hasLocalPrice: row.has_local_price,
      vectorDistance: distance,
    };
  });
}
