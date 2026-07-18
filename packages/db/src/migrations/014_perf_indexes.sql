-- 014_perf_indexes.sql
-- Hot-path indexes found missing in the 2026-07-17 review and change-only
-- semantic dirty triggers.

-- activePromotions joins listing.item_code -> promotion_item on every
-- compare_prices / basket optimize; only (promotion_id, item_code) PK and
-- item_code_norm existed.
CREATE INDEX IF NOT EXISTS promotion_item_code_idx ON promotion_item (item_code);

-- suggestSubstitutes filters on category_l1/category_l2; unindexed arms of an
-- OR force full scans of product.
CREATE INDEX IF NOT EXISTS product_category_l1_idx ON product (category_l1) WHERE category_l1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_category_l2_idx ON product (category_l2) WHERE category_l2 IS NOT NULL;

-- Active-now predicate is start_ts <= now() AND end_ts >= now(); the old
-- (start_ts, end_ts) index has a uselessly unselective leading column.
CREATE INDEX IF NOT EXISTS promotion_chain_end_ts_idx ON promotion (chain_id, end_ts);

-- Exact duplicate of 006's product_embedding_model_idx.
DROP INDEX IF EXISTS product_embedding_model_only_idx;

-- UPDATE OF name fires on ASSIGNMENT, not change; every upsert of every
-- ingest run re-dirtied the whole catalog. WHEN clauses make the queue
-- reflect real changes only. INSERTs must still always enqueue, so the
-- insert trigger is split out (WHEN with OLD is illegal on INSERT).
DROP TRIGGER IF EXISTS product_semantic_dirty_trg ON product;
CREATE TRIGGER product_semantic_dirty_ins_trg
  AFTER INSERT ON product
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_semantic_index_dirty();
CREATE TRIGGER product_semantic_dirty_upd_trg
  AFTER UPDATE OF name, brand ON product
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.brand IS DISTINCT FROM NEW.brand)
  EXECUTE FUNCTION enqueue_semantic_index_dirty();

DROP TRIGGER IF EXISTS listing_semantic_dirty_trg ON listing;
CREATE TRIGGER listing_semantic_dirty_ins_trg
  AFTER INSERT ON listing
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_semantic_index_dirty();
CREATE TRIGGER listing_semantic_dirty_upd_trg
  AFTER UPDATE OF name, product_id ON listing
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.product_id IS DISTINCT FROM NEW.product_id)
  EXECUTE FUNCTION enqueue_semantic_index_dirty();
