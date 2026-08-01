-- The chains told us which stores are online. We were not reading it.
--
-- The price-transparency Stores file carries <StoreType>, the chain's own
-- declaration of what an endpoint is:
--
--   1  physical branch
--   2  online / e-commerce endpoint (no till, nobody walks in)
--   3  both — a real branch that also fulfils web orders
--
-- Every chain we ingest populates it. `parseStoresXml` never read the element,
-- so `store_kind` was instead guessed from the store's name and address, and
-- then patched by three separate migrations (023 keywords, 024 URL-only
-- addresses, 028 picking depots). Measured against the feeds we hold, the guess
-- and the declaration disagree in both directions:
--
--   מרלוג אינטרנט (Rami Levy 039)  guessed 'warehouse', feed says 2 = online
--   קולינריק חורב (Keshet 103)     needed a hand-carved exception in 024,
--                                  feed says 3 = both, which says it directly
--
-- Storing the declared value lets `upsertStore` treat a Stores-XML row as
-- authoritative in both directions, which no other source is entitled to be:
-- price-file stubs carry no <StoreType> and so can never clobber it.

ALTER TABLE store ADD COLUMN IF NOT EXISTS feed_store_type smallint;

COMMENT ON COLUMN store.feed_store_type IS
  'The chain''s own <StoreType> from the Stores feed: 1 physical, 2 online, 3 both. NULL when the row was stubbed from a price file or the chain omitted the element.';

-- Existing rows are left NULL rather than backfilled from a re-parse: the value
-- only exists in the feed files, so the next Stores ingest per chain fills it in
-- correctly and cheaply. NULL means "not declared", which is exactly true.

-- One repair cannot wait for that ingest, because it is currently hiding the
-- second-largest online catalogue in the database.
--
-- מרלוג אינטרנט is Rami Levy's internet fulfilment centre: 15,790 prices, and
-- the storefront behind rami-levy.co.il. 023 read "מרלוג" and filed it under
-- warehouse, which is the right word for a depot that restocks branches and the
-- wrong one for a shop that ships to customers. The feed calls it type 2. Left
-- as-is, Rami Levy is simply absent from every online query.
--
-- The predicate is deliberately narrow: a distribution centre that restocks
-- branches is never named "internet". Only rows already classified 'warehouse'
-- are touched, so nothing that 023/024/028 identified more specifically moves.
UPDATE store
SET store_kind = 'online',
    updated_at = now()
WHERE store_kind = 'warehouse'
  AND name ~* '(אינטרנט|internet|online|אונליין|און[[:space:]]*ליין|ecom|e-?commerce)';

-- Online endpoints are selected as a set (every storefront that can serve an
-- address), never scanned by distance, so they need their own index: the
-- existing store_branch_geo_idx is partial on store_kind = 'branch'.
CREATE INDEX IF NOT EXISTS store_online_chain_idx ON store (chain_id, store_kind)
  WHERE store_kind IN ('online', 'pickup');
