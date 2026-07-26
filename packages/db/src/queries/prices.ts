import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";
import { priceHistoryEnabled } from "./priceHistory.js";

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
  // A data-modifying CTE runs whether or not the outer query references it, so
  // `ups` still performs the upsert when history is off; only the extra INSERT
  // and its index maintenance go away.
  const historyTail = priceHistoryEnabled()
    ? `INSERT INTO price_point (listing_id, store_id, price, unit_price, currency, source_ts)
       SELECT ups.listing_id, ups.store_id, ups.price, ups.unit_price, ups.currency, ups.source_ts
       FROM ups
       LEFT JOIN old ON true
       WHERE old.price IS NULL OR abs(old.price - ups.price) > 0.0005`
    : `SELECT 1 FROM ups`;
  // Single round-trip: read previous price, upsert current, append history only when
  // the applied shelf price actually changed (or this is the first row).
  await q.query(
    `WITH old AS (
       SELECT price FROM store_price WHERE listing_id = $1 AND store_id = $2
     ),
     ups AS (
       INSERT INTO store_price (
         listing_id, store_id, price, unit_price, currency, allow_discount, source_ts,
         ingested_at, last_seen_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
       -- Per-column monotonic gate rather than a row-level WHERE: last_seen_at
       -- must advance even when the feed republishes an OLDER PriceUpdateDate,
       -- otherwise a still-stocked item looks delisted to reconciliation. Price
       -- and source_ts still only ever move forward. (A second data-modifying
       -- CTE touching this same row would be unpredictable in Postgres, so the
       -- refresh has to happen inside this one statement.)
       ON CONFLICT (listing_id, store_id) DO UPDATE SET
         price = CASE WHEN store_price.source_ts <= EXCLUDED.source_ts
                      THEN EXCLUDED.price ELSE store_price.price END,
         unit_price = CASE WHEN store_price.source_ts <= EXCLUDED.source_ts
                           THEN EXCLUDED.unit_price ELSE store_price.unit_price END,
         currency = CASE WHEN store_price.source_ts <= EXCLUDED.source_ts
                         THEN EXCLUDED.currency ELSE store_price.currency END,
         allow_discount = CASE WHEN store_price.source_ts <= EXCLUDED.source_ts
                               THEN EXCLUDED.allow_discount ELSE store_price.allow_discount END,
         source_ts = GREATEST(store_price.source_ts, EXCLUDED.source_ts),
         ingested_at = CASE WHEN store_price.source_ts <= EXCLUDED.source_ts
                            THEN now() ELSE store_price.ingested_at END,
         last_seen_at = now()
       RETURNING listing_id, store_id, price, unit_price, currency, source_ts
     )
     ${historyTail}`,
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
