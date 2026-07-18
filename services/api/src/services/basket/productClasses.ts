import { query } from "@super-mcp/db";
import type { ClassPath } from "@super-mcp/shared";

/**
 * Load the offline LLM classification (migration 017 product_class_map) for a set
 * of candidate product ids. Read-only; the request path never classifies. Products
 * with no row simply return no entry — callers treat that as "unknown", which never
 * counts as a class disagreement, so the system is correct at any classification
 * coverage (1% or 100%). A row whose input_name drifted from the current product
 * name is stale and ignored here (the offline incremental run re-classifies it).
 */
export async function loadProductClasses(
  productIds: string[],
): Promise<Map<string, ClassPath>> {
  const map = new Map<string, ClassPath>();
  if (productIds.length === 0) return map;
  const { rows } = await query<{
    product_id: string;
    class_l1: string;
    class_l2: string | null;
    class_l3: string | null;
  }>(
    `SELECT m.product_id, m.class_l1, m.class_l2, m.class_l3
       FROM product_class_map m
       JOIN product p ON p.id = m.product_id
      WHERE m.product_id = ANY($1::uuid[])
        AND m.input_name = p.name`,
    [productIds],
  );
  for (const r of rows) {
    map.set(r.product_id, { l1: r.class_l1, l2: r.class_l2, l3: r.class_l3 });
  }
  return map;
}
