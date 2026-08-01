-- A product a shopper cannot buy at any branch does not belong in the
-- drive-to-the-shop search.
--
-- The online ingest adds products that exist only online: marketplace listings,
-- and chain-scoped items from storefronts that publish no barcode. They are real
-- and the delivery surface needs them. On the physical surface they are pure
-- cost, because no branch stocks them and nothing can ever price them:
--
--   catalogue before the first online ingest   122,575 products
--   added by one partial online run              8,639 products (+7%)
--   measured effect on a 6-line Tel Aviv basket
--     search      1,235 ms ->  3,553 ms
--     equivalence   100 ms ->  2,210 ms   (22x)
--     pricing       456 ms ->  4,590 ms   (10x)
--     end to end   ~1.3 s   -> ~11 s
--
-- The blow-up is not the row count itself. It is that these products win
-- candidate slots on name score, then drag the class-equivalence and pricing
-- passes along behind them before being discarded for having no branch price.
--
-- `store_count` cannot express this: it counts every store, so an item sold only
-- through Wolt looks as popular as one on 300 shelves. This column counts only
-- shoppable branches, which lets the physical surface ask its actual question,
-- "can this be bought by walking in", as an indexed predicate rather than as
-- work discovered several passes later.
--
-- Deliberately NOT scoped to price_source: a Shufersal-ONLINE-only item is
-- exactly as unbuyable at a branch as a Wolt one, and the 2,681 such items were
-- already costing the physical surface before any scraping existed.

ALTER TABLE product ADD COLUMN IF NOT EXISTS branch_store_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN product.branch_store_count IS
  'Distinct store_kind=branch stores currently pricing this product. 0 means it cannot be bought in person, whatever store_count says. Maintained by refreshProductStoreCounts.';

-- Seed it in the same shape refreshProductStoreCounts uses, so a database that
-- migrates without an immediate ingest is correct rather than empty.
UPDATE product p
   SET branch_store_count = COALESCE(c.n, 0)
  FROM (
    SELECT l.product_id, count(DISTINCT sp.store_id) AS n
      FROM listing l
      JOIN store_price sp ON sp.listing_id = l.id
      JOIN store s ON s.id = sp.store_id
     WHERE s.store_kind = 'branch'
     GROUP BY l.product_id
  ) c
 WHERE c.product_id = p.id;

-- The physical search filters on this on every query.
CREATE INDEX IF NOT EXISTS product_branch_store_count_idx ON product (branch_store_count)
  WHERE branch_store_count > 0;
