-- Query-performance indexes for geo store lookup, basket/price joins, and promo matching.
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS; backfill only touches NULL rows.

-- 1. Partial index for nearby-store geo queries (skip rows with missing/zero coords)
CREATE INDEX IF NOT EXISTS store_geo_idx ON store (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat <> 0 AND lng <> 0;

-- 2. Basket/price join paths
-- store_price PK is already (listing_id, store_id) — no redundant index needed.
CREATE INDEX IF NOT EXISTS listing_product_chain_idx ON listing (product_id, chain_id);

-- 3. Normalized item code on promotion_item for faster promo ↔ listing joins
ALTER TABLE promotion_item ADD COLUMN IF NOT EXISTS item_code_norm TEXT;

UPDATE promotion_item
SET item_code_norm = regexp_replace(item_code, '\D', '', 'g')
WHERE item_code_norm IS NULL;

CREATE INDEX IF NOT EXISTS promotion_item_code_norm_idx ON promotion_item (item_code_norm)
  WHERE item_code_norm <> '';

CREATE INDEX IF NOT EXISTS listing_item_code_idx ON listing (chain_id, item_code);
