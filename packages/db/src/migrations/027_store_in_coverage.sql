-- store.in_coverage: is this branch inside the area the ingest actually refreshes?
--
-- The nightly ingest only refreshes stores in Gush Dan/Sharon, Jerusalem, Haifa and
-- Beersheva (SUPER_MCP_REGION_FILTER, regions.ts). Stores outside that area exist
-- only because the 2026-07-18 backfill ran nationally with the filter off. Measured
-- 2026-07-26: 277 of 888 branches are outside, their prices are frozen at 07-18, and
-- they will never refresh. The API served them anyway, so a shopper in Eilat got
-- steadily older prices with nothing to say the branch is out of scope.
--
-- NULL means "not yet evaluated" and is treated as visible, so applying this
-- migration alone never hides a store. The marking script decides, using the same
-- isStoreInIngestRegion() the ingest uses, and the ingest sets true for every store
-- it upserts (a store only reaches upsertStore after passing the region filter).
--
-- Reversible: set the column back to NULL to show everything again.

ALTER TABLE store ADD COLUMN IF NOT EXISTS in_coverage boolean;

COMMENT ON COLUMN store.in_coverage IS
  'True when this store sits in the ingest coverage region and so gets refreshed. False means its prices are frozen and it should not be recommended. NULL means not evaluated, treated as visible.';

-- Store selection filters on this alongside store_kind and the geo predicate.
CREATE INDEX IF NOT EXISTS store_coverage_idx ON store (in_coverage)
  WHERE in_coverage IS NOT TRUE;
