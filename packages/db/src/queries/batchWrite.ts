import type { PoolClient } from "pg";
import { getPool } from "../client/index.js";

/**
 * Batched hot-path writes for ingestion. Each price row previously cost three
 * serial round-trips (resolveProduct, upsertListing, upsertStorePrice); these
 * helpers collapse a buffer of rows into one multi-row upsert each, preserving
 * the exact per-row semantics (GTIN-first identity, longest-name election,
 * source_ts monotonic gate, change-only price_point history).
 *
 * Callers MUST pre-dedupe by the relevant conflict key: Postgres rejects an
 * ON CONFLICT DO UPDATE that would touch the same row twice in one statement.
 */

export interface BatchProductInput {
  /** Identity key: the GTIN, or the chain-scoped sourceKey for non-GTIN items. */
  gtin: string | null;
  sourceKey: string | null;
  name: string;
  brand: string | null;
  sizeQty: number | null;
  sizeUnit: string | null;
}

/**
 * Bulk GTIN-first product resolution. Returns a map from identity key
 * (gtin ?? sourceKey) to product id. GTIN and non-GTIN rows conflict on
 * different constraints, so they are upserted in two statements.
 */
export async function bulkResolveProducts(
  rows: BatchProductInput[],
  client?: PoolClient,
): Promise<Map<string, string>> {
  const q = client ?? getPool();
  const out = new Map<string, string>();
  if (rows.length === 0) return out;

  const gtinRows = rows.filter((r) => r.gtin);
  const keyRows = rows.filter((r) => !r.gtin && r.sourceKey);

  if (gtinRows.length > 0) {
    const res = await q.query<{ id: string; gtin: string }>(
      `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit)
       SELECT gtin, NULL, name, brand, size_qty, size_unit
       FROM unnest($1::text[], $2::text[], $3::text[], $4::double precision[], $5::text[])
         AS t(gtin, name, brand, size_qty, size_unit)
       ON CONFLICT (gtin) DO UPDATE SET
         name = CASE WHEN length(EXCLUDED.name) > length(product.name)
                     THEN EXCLUDED.name ELSE product.name END,
         brand = COALESCE(EXCLUDED.brand, product.brand),
         size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
         size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
         updated_at = now()
       RETURNING id, gtin`,
      [
        gtinRows.map((r) => r.gtin),
        gtinRows.map((r) => r.name),
        gtinRows.map((r) => r.brand),
        gtinRows.map((r) => r.sizeQty),
        gtinRows.map((r) => r.sizeUnit),
      ],
    );
    for (const row of res.rows) out.set(row.gtin, row.id);
  }

  if (keyRows.length > 0) {
    const res = await q.query<{ id: string; source_key: string }>(
      `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit)
       SELECT NULL, source_key, name, brand, size_qty, size_unit
       FROM unnest($1::text[], $2::text[], $3::text[], $4::double precision[], $5::text[])
         AS t(source_key, name, brand, size_qty, size_unit)
       ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
         name = CASE WHEN length(EXCLUDED.name) > length(product.name)
                     THEN EXCLUDED.name ELSE product.name END,
         brand = COALESCE(EXCLUDED.brand, product.brand),
         size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
         size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
         updated_at = now()
       RETURNING id, source_key`,
      [
        keyRows.map((r) => r.sourceKey),
        keyRows.map((r) => r.name),
        keyRows.map((r) => r.brand),
        keyRows.map((r) => r.sizeQty),
        keyRows.map((r) => r.sizeUnit),
      ],
    );
    for (const row of res.rows) out.set(row.source_key, row.id);
  }

  return out;
}

export interface BatchListingInput {
  productId: string | null;
  chainId: string;
  itemCode: string;
  itemType: number;
  isGtin: boolean;
  name: string;
  brand: string | null;
  qty: number | null;
  unit: string | null;
  canonicalQty: number | null;
  canonicalUnit: string | null;
  measureUnparseable: boolean;
}

/**
 * Bulk listing upsert keyed on (chain_id, item_code). Returns a map from
 * "chainId itemCode" to listing id. Mirrors upsertListing's COALESCE merge.
 */
export async function bulkUpsertListings(
  rows: BatchListingInput[],
  client?: PoolClient,
): Promise<Map<string, string>> {
  const q = client ?? getPool();
  const out = new Map<string, string>();
  if (rows.length === 0) return out;

  const res = await q.query<{ id: string; chain_id: string; item_code: string }>(
    `INSERT INTO listing (
       product_id, chain_id, item_code, item_type, is_gtin, name, brand,
       qty, unit, canonical_qty, canonical_unit, measure_unparseable
     )
     SELECT product_id, chain_id, item_code, item_type, is_gtin, name, brand,
            qty, unit, canonical_qty, canonical_unit, measure_unparseable
     FROM unnest(
       $1::uuid[], $2::text[], $3::text[], $4::int[], $5::boolean[], $6::text[],
       $7::text[], $8::double precision[], $9::text[], $10::double precision[],
       $11::text[], $12::boolean[]
     ) AS t(product_id, chain_id, item_code, item_type, is_gtin, name, brand,
            qty, unit, canonical_qty, canonical_unit, measure_unparseable)
     ON CONFLICT (chain_id, item_code) DO UPDATE SET
       product_id = COALESCE(EXCLUDED.product_id, listing.product_id),
       item_type = EXCLUDED.item_type,
       is_gtin = EXCLUDED.is_gtin,
       name = EXCLUDED.name,
       brand = COALESCE(EXCLUDED.brand, listing.brand),
       qty = COALESCE(EXCLUDED.qty, listing.qty),
       unit = COALESCE(EXCLUDED.unit, listing.unit),
       canonical_qty = COALESCE(EXCLUDED.canonical_qty, listing.canonical_qty),
       canonical_unit = COALESCE(EXCLUDED.canonical_unit, listing.canonical_unit),
       measure_unparseable = EXCLUDED.measure_unparseable,
       updated_at = now()
     RETURNING id, chain_id, item_code`,
    [
      rows.map((r) => r.productId),
      rows.map((r) => r.chainId),
      rows.map((r) => r.itemCode),
      rows.map((r) => r.itemType),
      rows.map((r) => r.isGtin),
      rows.map((r) => r.name),
      rows.map((r) => r.brand),
      rows.map((r) => r.qty),
      rows.map((r) => r.unit),
      rows.map((r) => r.canonicalQty),
      rows.map((r) => r.canonicalUnit),
      rows.map((r) => r.measureUnparseable),
    ],
  );
  for (const row of res.rows) out.set(`${row.chain_id} ${row.item_code}`, row.id);
  return out;
}

export interface BatchPriceInput {
  listingId: string;
  storeId: string;
  price: number;
  unitPrice: number | null;
  currency: string;
  allowDiscount: boolean | null;
  sourceTs: Date;
}

/**
 * Bulk store_price upsert with the same source_ts monotonic gate and
 * change-only price_point append as upsertStorePrice, in one round-trip.
 */
export async function bulkUpsertStorePrices(
  rows: BatchPriceInput[],
  client?: PoolClient,
): Promise<void> {
  const q = client ?? getPool();
  if (rows.length === 0) return;

  await q.query(
    `WITH input AS (
       SELECT * FROM unnest(
         $1::uuid[], $2::uuid[], $3::numeric[], $4::numeric[], $5::text[],
         $6::boolean[], $7::timestamptz[]
       ) AS t(listing_id, store_id, price, unit_price, currency, allow_discount, source_ts)
     ),
     old AS (
       SELECT sp.listing_id, sp.store_id, sp.price AS old_price
       FROM store_price sp
       JOIN input i ON i.listing_id = sp.listing_id AND i.store_id = sp.store_id
     ),
     ups AS (
       INSERT INTO store_price (
         listing_id, store_id, price, unit_price, currency, allow_discount, source_ts, ingested_at
       )
       SELECT listing_id, store_id, price, unit_price, currency, allow_discount, source_ts, now()
       FROM input
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
     SELECT u.listing_id, u.store_id, u.price, u.unit_price, u.currency, u.source_ts
     FROM ups u
     LEFT JOIN old o ON o.listing_id = u.listing_id AND o.store_id = u.store_id
     WHERE o.old_price IS NULL OR abs(o.old_price - u.price) > 0.0005`,
    [
      rows.map((r) => r.listingId),
      rows.map((r) => r.storeId),
      rows.map((r) => r.price),
      rows.map((r) => r.unitPrice),
      rows.map((r) => r.currency),
      rows.map((r) => r.allowDiscount),
      rows.map((r) => r.sourceTs),
    ],
  );
}
