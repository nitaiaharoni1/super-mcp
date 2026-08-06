import type { PoolClient } from "pg";
import {
  classifyStoreKind,
  normalizeStoreCoordinates,
  type PriceSource,
  type StoreKind,
} from "@super-mcp/shared";
import { getPool } from "../client/index.js";

export interface UpsertChainInput {
  id: string;
  sourceId: string;
  market: string;
  nameHe: string;
  nameEn?: string;
  currency?: string;
}

/** Offline fixtures must never claim ownership of a chain a real feed supplies. */
const FIXTURE_SOURCE_ID = "il-fixture";

export async function upsertChain(input: UpsertChainInput, client?: PoolClient) {
  const q = client ?? getPool();
  // source_id ownership: a real source always takes over a fixture-owned row
  // (Shufersal and Rami Levy were both stuck on 'il-fixture', which broke
  // per-source health and reapStaleRuns' `WHERE source_id = $1` filter), but a
  // fixture run must never downgrade a chain a real adapter owns.
  await q.query(
    `INSERT INTO chain (id, source_id, market, name_he, name_en, currency)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       source_id = CASE
         WHEN EXCLUDED.source_id = '${FIXTURE_SOURCE_ID}'
              AND chain.source_id <> '${FIXTURE_SOURCE_ID}' THEN chain.source_id
         ELSE EXCLUDED.source_id
       END,
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
  /** branch | online | pickup | warehouse — see classifyStoreKind in shared. */
  storeKind?: StoreKind;
  /** The feed's own `<StoreType>`: 1 physical, 2 online, 3 both. */
  feedStoreType?: number;
  /** feed (regulated filing) or scraped (read off a website). */
  priceSource?: PriceSource;
}

export async function upsertStore(input: UpsertStoreInput, client?: PoolClient): Promise<string> {
  const q = client ?? getPool();
  const geo = normalizeStoreCoordinates(input.lat, input.lng);
  // Derived here rather than trusted from the caller so no ingestion path can
  // forget it and leave an online storefront ranked as a shoppable branch.
  const storeKind =
    input.storeKind ?? classifyStoreKind(input.name, input.address, input.feedStoreType);
  // Price/promo files may stub a branch before (or after) Stores XML lands.
  // Never let a "Store NNN" placeholder clobber a real branch name, and never
  // let a reingest erase or downgrade a hard-won geocoded point: coordinates are
  // kept unless the feed supplies its own, and provenance (geo_source) survives
  // untouched except to (a) mark real feed coords 'feed' or (b) reset to NULL so
  // the address geocoder re-runs when a branch's street address actually changes.
  const res = await q.query<{ id: string }>(
    `INSERT INTO store (chain_id, store_code, name, address, city, zip, lat, lng, geo_source, store_kind, feed_store_type, price_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (chain_id, store_code) DO UPDATE SET
       name = CASE
         WHEN EXCLUDED.name ~ '^Store[[:space:]]' THEN store.name
         ELSE EXCLUDED.name
       END,
       -- Positive evidence (a non-branch kind) always wins. A "Store NNN"
       -- placeholder stubbed from a price file classifies as 'branch' and must
       -- never downgrade a storefront already identified from the Stores XML.
       --
       -- A row carrying the chain's own <StoreType> outranks even that, in BOTH
       -- directions: only the Stores XML sets it, and it is the one source
       -- entitled to say "this really is a branch" and undo an earlier guess.
       -- Reaching past the first branch means today's row carries no <StoreType>,
       -- so its kind is a guess from the name alone. That guess must not undo a
       -- storefront a real <StoreType> already confirmed: "מרלוג אינטרנט" reads as
       -- a warehouse on its name and is only known to be Rami Levy's online store
       -- because the feed said StoreType 2. Let the guess win and the next run
       -- reads back 'warehouse', the ingestion backstop skips it as not orderable,
       -- and the chain's delivery catalogue disappears with nothing logged.
       store_kind = CASE
         WHEN EXCLUDED.feed_store_type IS NOT NULL THEN EXCLUDED.store_kind
         WHEN store.feed_store_type IS NOT NULL
           AND store.store_kind IN ('online', 'pickup') THEN store.store_kind
         WHEN EXCLUDED.store_kind <> 'branch' THEN EXCLUDED.store_kind
         WHEN EXCLUDED.name ~ '^Store[[:space:]]' THEN store.store_kind
         ELSE EXCLUDED.store_kind
       END,
       -- Price-file stubs carry no <StoreType>; never let one erase the real value.
       feed_store_type = COALESCE(EXCLUDED.feed_store_type, store.feed_store_type),
       -- A store keeps the provenance of whichever source is writing it now. A
       -- chain can have both (Victory files branches AND runs a scraped
       -- storefront), and each row must say which it is.
       --
       -- 'scraped' is sticky against a bare 'feed' write, because 'feed' is the
       -- column default and therefore also what an unrelated caller that forgot
       -- to pass provenance would send. Losing the flag that way is silent and
       -- makes a scraped price indistinguishable from a filed one; a store that
       -- genuinely moves onto a regulated feed is a deliberate reingest, and it
       -- gets its own store row from the Stores file anyway.
       price_source = CASE
         WHEN store.price_source = 'scraped' AND EXCLUDED.price_source = 'feed'
              AND EXCLUDED.name ~ '^Store[[:space:]]' THEN store.price_source
         ELSE EXCLUDED.price_source
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
      storeKind,
      input.feedStoreType ?? null,
      input.priceSource ?? "feed",
    ],
  );
  return res.rows[0]!.id;
}
