-- How many stores currently stock a product, so search can break score ties on
-- something a shopper cares about.
--
-- Every product whose name STARTS with the query word scores exactly 0.95 in
-- the lexical ranker, so a one-word query ties hundreds of products. The
-- tiebreak was `p.name ASC` and the pool is cut at 20, which made a generic
-- query an alphabet lottery:
--
--   "שמן"  ->  שמן אבטיח, שמן אורגנו פראי, שמן ארגאן, שמן ארומטי לימון
--              (watermelon, oregano, argan, lemon)
--
-- while שמן קנולה (747 stores) and שמן חמניות (398) were never retrieved at all.
-- Nothing downstream could recover them: the availability upgrade can only pick
-- among candidates it was handed, and the best one it ever saw sat in 8 stores.
--
-- National, not local, on purpose. This exists to get mainstream products INTO
-- the candidate pool; choosing among them by what is stocked near THIS shopper
-- is already handled later by `betterCoveredPeer`. Keeping the two separate
-- means the retrieval signal stays stable and cacheable.
--
-- Recomputed in full after every ingest (`refreshProductStoreCounts`); the whole
-- aggregate over 122,575 products takes 0.8s, so incremental maintenance would
-- be more risk than it is worth.

ALTER TABLE product ADD COLUMN IF NOT EXISTS store_count integer NOT NULL DEFAULT 0;

UPDATE product p
SET store_count = c.n
FROM (
  SELECT l.product_id, count(DISTINCT sp.store_id) AS n
    FROM listing l
    JOIN store_price sp ON sp.listing_id = l.id
   GROUP BY l.product_id
) c
WHERE c.product_id = p.id
  AND p.store_count IS DISTINCT FROM c.n;

-- Used only as an ORDER BY tiebreak inside an already-bounded candidate set, so
-- no index: it would cost write time on every ingest and buy nothing.
