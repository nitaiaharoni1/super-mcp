-- Three related data-honesty fixes.
--
-- 1. store.store_kind
--    Feeds publish online storefronts, pickup points and logistics warehouses as
--    ordinary <Store> rows. They carry real prices — and the three deepest
--    catalogs in the DB are exactly these (שופרסל ONLINE, מרלוג אינטרנט,
--    קרפור אונליין) — but they are not places a shopper can drive to, so basket
--    recommendations must be able to exclude them. Mirrors classifyStoreKind()
--    in @super-mcp/shared (precedence: warehouse > pickup > online > branch).
--
-- 2. store_price.last_seen_at
--    The price upsert is gated on `store_price.source_ts <= EXCLUDED.source_ts`,
--    so a row whose feed PriceUpdateDate goes backwards is NOT touched and keeps
--    a stale ingested_at even though the item was just seen on the shelf. That
--    conflates "last changed" with "last seen" and makes it impossible to tell a
--    delisted item from an unchanged one. last_seen_at is ALWAYS refreshed on
--    conflict and is the only safe basis for reconciling vanished items.
--
-- 3. chain.source_id repair
--    Shufersal and Rami Levy were first created by the fixture adapter and
--    nothing ever corrected them, so the two biggest chains claim
--    source_id='il-fixture'. That breaks per-source health and reapStaleRuns(),
--    which filters `WHERE source_id = $1`.

-- 1 ---------------------------------------------------------------------------
ALTER TABLE store ADD COLUMN IF NOT EXISTS store_kind text NOT NULL DEFAULT 'branch';

COMMENT ON COLUMN store.store_kind IS
  'Endpoint type: branch | online | pickup | warehouse. Only ''branch'' is shoppable in person.';

-- Backfill from name+address. Precedence matches classifyStoreKind exactly:
-- "מרלוג אינטרנט" is a warehouse (not online), and a pickup point that also
-- advertises delivery is a pickup point.
--   - 'מחסן\s' (not 'מחסני') so the chain מחסני השוק is never mis-typed.
--   - No bare 'dc': it fired on any name ending in those letters. Dropped from
--     classifyStoreKind too, so backfill and runtime stay byte-identical.
UPDATE store
SET store_kind = CASE
      WHEN haystack ~* '(מרלוג|מחסן\s|לוגיסטי|logistic|warehouse|מרכז\s*הפצה)' THEN 'warehouse'
      WHEN haystack ~* '(pick\s*-?\s*up|פיק\s*-?\s*אפ|פיקאפ|איסוף|drive\s*-?\s*in)' THEN 'pickup'
      WHEN haystack ~* '(online|on\s*line|אונליין|און\s*ליין|אינטרנט|internet|ecom|e-?commerce|וולט|wolt|יאנגו|yango|ten\s*bis|טן\s*ביס|משלוח)' THEN 'online'
      ELSE 'branch'
    END,
    updated_at = now()
FROM (
  SELECT id AS sid, name || ' ' || coalesce(address, '') AS haystack FROM store
) AS src
WHERE store.id = src.sid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_kind_valid_check'
  ) THEN
    ALTER TABLE store ADD CONSTRAINT store_kind_valid_check
      CHECK (store_kind IN ('branch', 'online', 'pickup', 'warehouse'));
  END IF;
END $$;

-- Recommendation queries filter to shoppable branches, usually alongside a
-- city/geo predicate, so index the discriminator for the common case.
CREATE INDEX IF NOT EXISTS store_kind_idx ON store (store_kind);
CREATE INDEX IF NOT EXISTS store_branch_geo_idx ON store (lat, lng)
  WHERE store_kind = 'branch'
    AND lat IS NOT NULL AND lng IS NOT NULL
    AND lat <> 0::double precision AND lng <> 0::double precision;

-- 2 ---------------------------------------------------------------------------
ALTER TABLE store_price ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN store_price.last_seen_at IS
  'When this listing was last present in a feed file for this store. Always refreshed on upsert, unlike source_ts/price which are gated on feed monotonicity. Basis for delisting reconciliation.';

-- Existing rows are deliberately left NULL.
--
-- Backfilling from ingested_at rewrote all 6.7M rows and held the migration's
-- transaction open for 6.5 minutes, which on a managed instance means lock
-- contention, WAL bloat and replica lag for a one-time convenience. It is not
-- needed: reconcileStorePrices() already treats NULL as "not seen in a tracked
-- snapshot", and its delete-ratio gate refuses to act when that would remove an
-- implausible share of a store's catalog. The first full-file ingest per store
-- stamps last_seen_at on everything still stocked, so the column becomes fully
-- populated through normal operation without a bulk rewrite.

-- Reconciliation scans one store at a time and deletes rows below a cutoff.
CREATE INDEX IF NOT EXISTS store_price_store_last_seen_idx
  ON store_price (store_id, last_seen_at);

-- 3 ---------------------------------------------------------------------------
-- Reassign the two chains the fixture adapter mislabeled. Restricted to exactly
-- the rows currently claiming 'il-fixture' so a correct row is never touched.
UPDATE chain SET source_id = 'il-shufersal', updated_at = now()
WHERE id = '7290027600007' AND source_id = 'il-fixture';

UPDATE chain SET source_id = 'il-cerberus', updated_at = now()
WHERE id = '7290058140886' AND source_id = 'il-fixture';
