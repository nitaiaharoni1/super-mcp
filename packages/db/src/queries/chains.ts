import type { PoolClient } from "pg";
import { normalizeStoreCoordinates } from "@super-mcp/shared";
import { getPool } from "../client/index.js";

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
  const geo = normalizeStoreCoordinates(input.lat, input.lng);
  // Price/promo files may stub a branch before (or after) Stores XML lands.
  // Never let a "Store NNN" placeholder clobber a real branch name, and never
  // let a reingest erase or downgrade a hard-won geocoded point: coordinates are
  // kept unless the feed supplies its own, and provenance (geo_source) survives
  // untouched except to (a) mark real feed coords 'feed' or (b) reset to NULL so
  // the address geocoder re-runs when a branch's street address actually changes.
  const res = await q.query<{ id: string }>(
    `INSERT INTO store (chain_id, store_code, name, address, city, zip, lat, lng, geo_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (chain_id, store_code) DO UPDATE SET
       name = CASE
         WHEN EXCLUDED.name ~ '^Store[[:space:]]' THEN store.name
         ELSE EXCLUDED.name
       END,
       address = COALESCE(EXCLUDED.address, store.address),
       city = COALESCE(EXCLUDED.city, store.city),
       zip = COALESCE(EXCLUDED.zip, store.zip),
       lat = CASE
         WHEN EXCLUDED.lat IS NOT NULL AND EXCLUDED.lng IS NOT NULL THEN EXCLUDED.lat
         ELSE store.lat
       END,
       lng = CASE
         WHEN EXCLUDED.lat IS NOT NULL AND EXCLUDED.lng IS NOT NULL THEN EXCLUDED.lng
         ELSE store.lng
       END,
       geo_source = CASE
         WHEN EXCLUDED.lat IS NOT NULL AND EXCLUDED.lng IS NOT NULL THEN 'feed'
         WHEN EXCLUDED.address IS NOT NULL
              AND EXCLUDED.address IS DISTINCT FROM store.address THEN NULL
         ELSE store.geo_source
       END,
       updated_at = now()
     RETURNING id`,
    [
      input.chainId,
      input.storeCode,
      input.name,
      input.address ?? null,
      input.city ?? null,
      input.zip ?? null,
      geo?.lat ?? null,
      geo?.lng ?? null,
      geo ? "feed" : null,
    ],
  );
  return res.rows[0]!.id;
}
