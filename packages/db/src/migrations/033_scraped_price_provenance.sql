-- Not every price in this database is a filed price any more.
--
-- Feed prices are published under the Price Transparency regulations: a legal
-- obligation to be accurate, on a schedule, in a documented format. Scraped
-- prices are a best-effort read of a website that can change shape or go behind
-- a challenge without notice, and they carry no such obligation.
--
-- Both are useful. Conflating them is not: an agent quoting "₪7.90 at Victory"
-- should be able to say where that number came from, and an operator debugging a
-- gap should be able to tell a feed outage (an incident) from a markup change on
-- someone else's site (a Tuesday).
--
-- Recorded on the STORE rather than on every price row. A store belongs to
-- exactly one acquisition path for its whole life, so this is 900-odd rows
-- instead of millions, and it cannot drift between a store and its prices.

ALTER TABLE store ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'feed';

COMMENT ON COLUMN store.price_source IS
  'How this store''s prices were acquired: feed (regulated price-transparency filing) or scraped (best-effort read of a retailer or marketplace site). Never present a scraped price as a filed one.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_price_source_check') THEN
    ALTER TABLE store ADD CONSTRAINT store_price_source_check
      CHECK (price_source IN ('feed', 'scraped'));
  END IF;
END $$;

-- Every store that exists today came from a feed, which is why 'feed' is the
-- default rather than something nullable: there is no unknown case to model.

CREATE INDEX IF NOT EXISTS store_price_source_idx ON store (price_source)
  WHERE price_source <> 'feed';

-- Scraped storefronts are reached through the same fulfillment_service rows as
-- the feed ones, so the service needs to say which source produced it. A Wolt
-- venue's terms are re-read on every ingest and are current to the minute; a
-- chain's are typed in by a human once a quarter. Those deserve different trust.
ALTER TABLE fulfillment_service ADD COLUMN IF NOT EXISTS terms_source text NOT NULL DEFAULT 'curated';

COMMENT ON COLUMN fulfillment_service.terms_source IS
  'curated = hand-read from the retailer''s terms page and subject to the 90-day TTL. scraped = re-derived automatically on every online ingest, so it does not decay the same way.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_service_terms_source_check') THEN
    ALTER TABLE fulfillment_service ADD CONSTRAINT fulfillment_service_terms_source_check
      CHECK (terms_source IN ('curated', 'scraped'));
  END IF;
END $$;
