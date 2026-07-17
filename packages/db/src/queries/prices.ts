import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";

export interface UpsertPriceInput {
  listingId: string;
  storeId: string;
  price: number;
  unitPrice: number | null;
  currency?: string;
  allowDiscount?: boolean;
  sourceTs: Date;
}

export async function upsertStorePrice(input: UpsertPriceInput, client?: PoolClient): Promise<void> {
  const q = client ?? getPool();
  // Single round-trip: read previous price, upsert current, append history only when
  // the applied shelf price actually changed (or this is the first row).
  await q.query(
    `WITH old AS (
       SELECT price FROM store_price WHERE listing_id = $1 AND store_id = $2
     ),
     ups AS (
       INSERT INTO store_price (
         listing_id, store_id, price, unit_price, currency, allow_discount, source_ts, ingested_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (listing_id, store_id) DO UPDATE SET
         price = EXCLUDED.price,
         unit_price = EXCLUDED.unit_price,
         currency = EXCLUDED.currency,
         allow_discount = EXCLUDED.allow_discount,
         source_ts = EXCLUDED.source_ts,
         ingested_at = now()
       WHERE store_price.source_ts <= EXCLUDED.source_ts
       RETURNING listing_id, store_id, price, unit_price, currency, source_ts
     )
     INSERT INTO price_point (listing_id, store_id, price, unit_price, currency, source_ts)
     SELECT ups.listing_id, ups.store_id, ups.price, ups.unit_price, ups.currency, ups.source_ts
     FROM ups
     LEFT JOIN old ON true
     WHERE old.price IS NULL OR abs(old.price - ups.price) > 0.0005`,
    [
      input.listingId,
      input.storeId,
      input.price,
      input.unitPrice,
      input.currency ?? "ILS",
      input.allowDiscount ?? null,
      input.sourceTs,
    ],
  );
}
