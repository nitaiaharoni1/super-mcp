import { query } from "@super-mcp/db";
import type { GetProductHistoryParams, HistoryRow, ProductHistoryPoint } from "./types.js";

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
     ORDER BY pp.source_ts DESC
     LIMIT 5000`,
    params,
  );

  // LIMIT keeps the newest window; reverse back to chronological for the API.
  return [...res.rows].reverse().map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    chainId: r.chain_id,
    price: Number(r.price),
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    currency: r.currency,
    sourceTs: r.source_ts,
  }));
}
