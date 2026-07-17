import { escapeIlike } from "@super-mcp/shared";
import { geoBoundingBoxSql, haversineKmSql } from "../../lib/geo.js";

export { escapeIlike };

export interface PriceExistsSqlOpts {
  scoped: boolean;
  cityParam?: number;
  nearLatParam?: number;
  nearLngParam?: number;
  radiusParam?: number;
  storeIdsParam?: number;
}

export function buildPriceExistsSql(
  productIdExpr: string,
  opts: PriceExistsSqlOpts,
): string {
  const joins = [
    `listing l`,
    `JOIN store_price sp ON sp.listing_id = l.id`,
  ];
  const conditions = [`l.product_id = ${productIdExpr}`, `sp.price > 0`];
  if (opts.scoped) {
    joins.push(`JOIN store st ON st.id = sp.store_id`);
    if (opts.storeIdsParam != null) {
      conditions.push(`st.id = ANY($${opts.storeIdsParam}::uuid[])`);
    }
    if (opts.cityParam != null) {
      conditions.push(`st.city = ANY($${opts.cityParam}::text[])`);
    }
    if (opts.nearLatParam != null && opts.nearLngParam != null && opts.radiusParam != null) {
      const dist = haversineKmSql(opts.nearLatParam, opts.nearLngParam, "st.lat", "st.lng");
      conditions.push(geoBoundingBoxSql(opts.nearLatParam, opts.nearLngParam, opts.radiusParam, "st.lat", "st.lng"));
      conditions.push(`${dist} <= $${opts.radiusParam}`);
    }
  }
  return `EXISTS (
    SELECT 1 FROM ${joins.join(" ")}
    WHERE ${conditions.join(" AND ")}
  )`;
}
