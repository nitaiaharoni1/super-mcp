-- Two indexes on the two largest tables are byte-for-byte duplicates of a
-- constraint index that was already there.
--
--   product.gtin          UNIQUE on the column (001_init.sql:43) creates
--                         product_gtin_key ON product USING btree (gtin).
--                         001_init.sql:55 then adds product_gtin_idx, the same
--                         btree on the same column.
--   listing               UNIQUE (chain_id, item_code) (001_init.sql:76) creates
--                         listing_chain_id_item_code_key ON listing USING btree
--                         (chain_id, item_code). 003_query_perf.sql:22 then adds
--                         listing_item_code_idx, the same btree on the same pair
--                         in the same order.
--
-- Verified identical against the live schema, not inferred from the migration
-- text: pg_indexes reports the two pairs with matching indexdef apart from the
-- name. The planner can use either one of a pair and never both, so the second
-- has never made a read faster.
--
-- What it has done is cost every write. A full national ingest rewrites listing
-- and product in bulk, and each row maintained four B-trees where two would do.
-- The duplicates also occupy shared_buffers that the indexes actually serving
-- queries -- the trigram GINs on listing.name and product.name, which the
-- lexical search path depends on -- would otherwise hold.
--
-- Dropping an index is reversible: the CREATE INDEX statements above are still
-- in 001 and 003 should this ever need undoing. Nothing reads by index NAME.
--
-- The constraint indexes are deliberately the survivors. Dropping those instead
-- would drop the uniqueness guarantee with them, which is the whole reason the
-- pair exists.

-- The migration runner wraps each file in a transaction and sets
-- statement_timeout = 0, so a DROP INDEX that cannot get its ACCESS EXCLUSIVE
-- lock would wait forever behind a live reader and hold every later query behind
-- it. Fail fast instead: this is pure cleanup and is never worth an outage.
-- Re-running the migration is free if it does time out.
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS product_gtin_idx;
DROP INDEX IF EXISTS listing_item_code_idx;
