-- Give non-GTIN listings a stable chain-scoped product identity instead of leaving
-- product_id NULL (which made them invisible to search/product/basket reads).
-- source_key is only ever set for gtin IS NULL rows ("<chain_id>:<item_code>"),
-- so it never competes with the gtin unique index.
--
-- Existing rows with product_id NULL stay invisible until re-ingest (or a one-off
-- backfill that sets source_key = chain_id || ':' || item_code and links listings).
ALTER TABLE product ADD COLUMN IF NOT EXISTS source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS product_source_key_idx
  ON product (source_key) WHERE source_key IS NOT NULL;
