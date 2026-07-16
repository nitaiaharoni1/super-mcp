import type { PoolClient, QueryResultRow } from "pg";
import { getPool } from "./client.js";

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  return getPool().query<T>(sql, params);
}

export interface UpsertChainInput {
  id: string;
  sourceId: string;
  market: string;
  nameHe: string;
  nameEn?: string;
  currency?: string;
}

export async function upsertChain(input: UpsertChainInput, client?: PoolClient) {
  const q = client ?? getPool();
  await q.query(
    `INSERT INTO chain (id, source_id, market, name_he, name_en, currency)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       source_id = EXCLUDED.source_id,
       name_he = EXCLUDED.name_he,
       name_en = COALESCE(EXCLUDED.name_en, chain.name_en),
       updated_at = now()`,
    [
      input.id,
      input.sourceId,
      input.market,
      input.nameHe,
      input.nameEn ?? null,
      input.currency ?? "ILS",
    ],
  );
}

export interface UpsertStoreInput {
  chainId: string;
  storeCode: string;
  name: string;
  address?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lng?: number;
}

export async function upsertStore(input: UpsertStoreInput, client?: PoolClient): Promise<string> {
  const q = client ?? getPool();
  const res = await q.query<{ id: string }>(
    `INSERT INTO store (chain_id, store_code, name, address, city, zip, lat, lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (chain_id, store_code) DO UPDATE SET
       name = EXCLUDED.name,
       address = COALESCE(EXCLUDED.address, store.address),
       city = COALESCE(EXCLUDED.city, store.city),
       zip = COALESCE(EXCLUDED.zip, store.zip),
       lat = COALESCE(EXCLUDED.lat, store.lat),
       lng = COALESCE(EXCLUDED.lng, store.lng),
       updated_at = now()
     RETURNING id`,
    [
      input.chainId,
      input.storeCode,
      input.name,
      input.address ?? null,
      input.city ?? null,
      input.zip ?? null,
      input.lat ?? null,
      input.lng ?? null,
    ],
  );
  return res.rows[0]!.id;
}

export interface ResolveProductInput {
  gtin: string | null;
  /** Chain-scoped identity for non-GTIN items ("<chain_id>:<item_code>"), used only when gtin is null. */
  sourceKey?: string;
  name: string;
  brand?: string;
  sizeQty?: number;
  sizeUnit?: string;
}

/**
 * GTIN-first identity: same GTIN => one product row, shared across chains/stores.
 * Non-GTIN items get one chain-scoped product keyed by sourceKey
 * ("<chain_id>:<item_code>"), never merged across chains.
 *
 * Uses INSERT … ON CONFLICT (atomic upsert) so parallel ingest jobs cannot
 * create duplicate product rows for the same identity key.
 */
export async function resolveProduct(
  input: ResolveProductInput,
  client?: PoolClient,
): Promise<string | null> {
  const q = client ?? getPool();
  if (!input.gtin && !input.sourceKey) return null;

  const name = input.name;
  const brand = input.brand ?? null;
  const sizeQty = input.sizeQty ?? null;
  const sizeUnit = input.sizeUnit ?? null;

  if (input.gtin) {
    const res = await q.query<{ id: string }>(
      `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit)
       VALUES ($1, NULL, $2, $3, $4, $5)
       ON CONFLICT (gtin) DO UPDATE SET
         name = CASE
           WHEN length(EXCLUDED.name) > length(product.name) THEN EXCLUDED.name
           ELSE product.name
         END,
         brand = COALESCE(EXCLUDED.brand, product.brand),
         size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
         size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
         updated_at = now()
       RETURNING id`,
      [input.gtin, name, brand, sizeQty, sizeUnit],
    );
    return res.rows[0]!.id;
  }

  const res = await q.query<{ id: string }>(
    `INSERT INTO product (gtin, source_key, name, brand, size_qty, size_unit)
     VALUES (NULL, $1, $2, $3, $4, $5)
     ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
       name = CASE
         WHEN length(EXCLUDED.name) > length(product.name) THEN EXCLUDED.name
         ELSE product.name
       END,
       brand = COALESCE(EXCLUDED.brand, product.brand),
       size_qty = COALESCE(EXCLUDED.size_qty, product.size_qty),
       size_unit = COALESCE(EXCLUDED.size_unit, product.size_unit),
       updated_at = now()
     RETURNING id`,
    [input.sourceKey!, name, brand, sizeQty, sizeUnit],
  );
  return res.rows[0]!.id;
}
export interface UpsertListingInput {
  productId: string | null;
  chainId: string;
  itemCode: string;
  itemType: number;
  isGtin: boolean;
  name: string;
  brand?: string;
  qty?: number;
  unit?: string;
  canonicalQty?: number;
  canonicalUnit?: string;
  measureUnparseable: boolean;
}

export async function upsertListing(input: UpsertListingInput, client?: PoolClient): Promise<string> {
  const q = client ?? getPool();
  const res = await q.query<{ id: string }>(
    `INSERT INTO listing (
       product_id, chain_id, item_code, item_type, is_gtin, name, brand,
       qty, unit, canonical_qty, canonical_unit, measure_unparseable
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
     RETURNING id`,
    [
      input.productId,
      input.chainId,
      input.itemCode,
      input.itemType,
      input.isGtin,
      input.name,
      input.brand ?? null,
      input.qty ?? null,
      input.unit ?? null,
      input.canonicalQty ?? null,
      input.canonicalUnit ?? null,
      input.measureUnparseable,
    ],
  );
  return res.rows[0]!.id;
}

/**
 * Deletes a stale listing left behind when the same physical item flips GTIN
 * classification across ingests (e.g. a borderline digit-length/itemType code
 * that resolves differently one run to the next). Listing identity is keyed on
 * (chain_id, item_code) where item_code = gtin ?? rawItemCode, so a flip makes
 * ON CONFLICT miss and creates a second row instead of updating the first —
 * orphaning the old one with stale price history and, once non-GTIN items got
 * a persistent product identity, a stale product_id that duplicates search/
 * basket results. Called with the *other* classification's key before every
 * upsertListing; a no-op when the two keys are identical (the common case for
 * clean feeds, since gtin == normalizeGtin(rawItemCode) already).
 */
export async function reapReclassifiedListing(
  chainId: string,
  currentItemCode: string,
  otherItemCode: string,
  client?: PoolClient,
): Promise<void> {
  if (currentItemCode === otherItemCode) return;
  const q = client ?? getPool();
  // promotion_item.listing_id references listing(id) with no ON DELETE clause (defaults to
  // RESTRICT), so clear any dangling reference first or the DELETE throws a FK violation.
  await q.query(
    `UPDATE promotion_item SET listing_id = NULL
     WHERE listing_id = (SELECT id FROM listing WHERE chain_id = $1 AND item_code = $2)`,
    [chainId, otherItemCode],
  );
  await q.query(`DELETE FROM listing WHERE chain_id = $1 AND item_code = $2`, [
    chainId,
    otherItemCode,
  ]);
}

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
  // Known trade-off: `changed` is read before the guarded upsert, not in the same
  // transaction, so a concurrent writer to the same (listing_id, store_id) could
  // make it stale by commit time. Ingestion runs process rows serially today, so
  // this is not currently reachable; revisit if concurrent same-source runs land.
  const prev = await q.query<{ price: string }>(
    `SELECT price::text FROM store_price WHERE listing_id = $1 AND store_id = $2`,
    [input.listingId, input.storeId],
  );
  const prevPrice = prev.rows[0] ? Number(prev.rows[0].price) : null;
  const changed = prevPrice == null || Math.abs(prevPrice - input.price) > 0.0005;

  const upsertRes = await q.query(
    `INSERT INTO store_price (
       listing_id, store_id, price, unit_price, currency, allow_discount, source_ts, ingested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (listing_id, store_id) DO UPDATE SET
       price = EXCLUDED.price,
       unit_price = EXCLUDED.unit_price,
       currency = EXCLUDED.currency,
       allow_discount = EXCLUDED.allow_discount,
       source_ts = EXCLUDED.source_ts,
       ingested_at = now()
     WHERE store_price.source_ts <= EXCLUDED.source_ts`,
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
  // rowCount 0 => the conflict row was newer (stale replay); don't record history either.
  const applied = (upsertRes.rowCount ?? 0) > 0;

  if (applied && changed) {
    await q.query(
      `INSERT INTO price_point (listing_id, store_id, price, unit_price, currency, source_ts)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.listingId,
        input.storeId,
        input.price,
        input.unitPrice,
        input.currency ?? "ILS",
        input.sourceTs,
      ],
    );
  }
}

export interface UpsertPromoInput {
  chainId: string;
  storeId: string | null;
  storeCode: string;
  promoCode: string;
  description: string;
  mechanicType: string;
  mechanicParams: Record<string, unknown>;
  rawText?: string;
  clubOnly: boolean;
  startTs: Date;
  endTs: Date;
  sourceTs: Date;
  itemCodes: string[];
}

export async function upsertPromotion(input: UpsertPromoInput, client?: PoolClient): Promise<string> {
  const q = client ?? getPool();
  const res = await q.query<{ id: string }>(
    `INSERT INTO promotion (
       chain_id, store_id, store_code, promo_code, description,
       mechanic_type, mechanic_params, raw_text, club_only,
       start_ts, end_ts, source_ts, ingested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (chain_id, store_code, promo_code) DO UPDATE SET
       store_id = COALESCE(EXCLUDED.store_id, promotion.store_id),
       description = EXCLUDED.description,
       mechanic_type = EXCLUDED.mechanic_type,
       mechanic_params = EXCLUDED.mechanic_params,
       raw_text = EXCLUDED.raw_text,
       club_only = EXCLUDED.club_only,
       start_ts = EXCLUDED.start_ts,
       end_ts = EXCLUDED.end_ts,
       source_ts = EXCLUDED.source_ts,
       ingested_at = now()
     RETURNING id`,
    [
      input.chainId,
      input.storeId,
      input.storeCode,
      input.promoCode,
      input.description,
      input.mechanicType,
      JSON.stringify(input.mechanicParams),
      input.rawText ?? null,
      input.clubOnly,
      input.startTs,
      input.endTs,
      input.sourceTs,
    ],
  );
  const promoId = res.rows[0]!.id;
  await q.query(`DELETE FROM promotion_item WHERE promotion_id = $1`, [promoId]);
  for (const code of input.itemCodes) {
    const listing = await q.query<{ id: string }>(
      `SELECT id FROM listing WHERE chain_id = $1 AND item_code = $2`,
      [input.chainId, code],
    );
    await q.query(
      `INSERT INTO promotion_item (promotion_id, item_code, listing_id)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [promoId, code, listing.rows[0]?.id ?? null],
    );
  }
  return promoId;
}
