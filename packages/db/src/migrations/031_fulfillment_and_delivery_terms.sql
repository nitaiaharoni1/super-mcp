-- Delivery terms: the one part of an online grocery order the feeds do not carry.
--
-- The price-transparency feeds already give us online storefronts and their real
-- prices (see 030). They say nothing about what it costs to have the order
-- brought to you, and for a delivered basket that is the dominant term: a ₪35.90
-- delivery fee is larger than the price gap between chains on most weekly shops.
-- Three tables:
--
--   fulfillment_service   one row per sellable online endpoint, plus the terms
--                         that are single values (minimum order, service fee)
--   delivery_tariff       the fee schedule, as bands over the basket subtotal
--   delivery_coverage     which addresses the service will actually deliver to
--
-- PROVENANCE IS NOT OPTIONAL HERE. Feed prices carry ingested_at/source_ts
-- because a stale price quoted as fact misleads a shopper; delivery terms are
-- worse, because they are gathered by a human reading a retailer's terms page and
-- they change in lumps. Rami Levy held ₪29.90 for fifteen years and then raised it
-- 20% in a single month. A table that looks fine, parses fine and is silently four
-- months out of date is the failure mode to design against, so every service
-- carries terms_confidence + terms_verified_at + terms_source_url, and the API is
-- expected to degrade to "fee unknown" rather than quote an unchecked number.

CREATE TABLE IF NOT EXISTS fulfillment_service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The feed's own online store row. This is what ties published terms to a real
  -- priced catalogue: no store_id means no basket can be priced, only described.
  store_id uuid REFERENCES store(id) ON DELETE CASCADE,
  chain_id text NOT NULL REFERENCES chain(id),

  -- Stable human-readable key, e.g. 'shufersal-online'. The seed catalogue is
  -- keyed on it so re-running the sync updates rather than duplicates.
  slug text NOT NULL UNIQUE,
  brand text NOT NULL,

  -- delivery   brought to the address
  -- pickup     click-and-collect; the shopper travels, so distance matters again
  -- marketplace a third party (Wolt, Yango) sells the chain's goods and sets its
  --            own prices — measured at +25% on the one such storefront that also
  --            files a regulated price feed
  service_type text NOT NULL,
  marketplace text,
  storefront_url text,

  -- Hard eligibility, not a ranking penalty: below this the order cannot be
  -- placed at all. NULL means the retailer states no minimum (Shufersal, Rami
  -- Levy both verified as having none), which is different from unknown.
  minimum_order numeric(12,2),
  minimum_order_known boolean NOT NULL DEFAULT true,

  -- Marketplace operations fee (דמי תפעול): a percentage of the pre-discount item
  -- total, with a floor and a cap. Wolt: 5%, ₪1.00–₪5.90. Chains do not charge it.
  service_fee_percent numeric(6,3),
  service_fee_min numeric(12,2),
  service_fee_max numeric(12,2),

  currency text NOT NULL DEFAULT 'ILS',
  active boolean NOT NULL DEFAULT true,

  -- verified   read from the retailer's own binding terms on terms_verified_at
  -- reported   a cited secondary source (press, comparison article)
  -- estimated  a category default, carried so the optimiser has SOMETHING to rank
  --            on — must never be presented to a shopper as the price
  terms_confidence text NOT NULL DEFAULT 'estimated',
  terms_verified_at timestamptz,
  terms_source_url text,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fulfillment_service_type_check
    CHECK (service_type IN ('delivery', 'pickup', 'marketplace')),
  CONSTRAINT fulfillment_service_confidence_check
    CHECK (terms_confidence IN ('verified', 'reported', 'estimated')),
  -- A percentage fee is meaningless without knowing where it is floored/capped.
  CONSTRAINT fulfillment_service_fee_complete_check
    CHECK (service_fee_percent IS NULL OR (service_fee_min IS NOT NULL AND service_fee_max IS NOT NULL))
);

COMMENT ON TABLE fulfillment_service IS
  'One sellable online endpoint (delivery, click-and-collect, or marketplace) and the order terms that are single values. Fee schedule lives in delivery_tariff, service area in delivery_coverage.';

CREATE INDEX IF NOT EXISTS fulfillment_service_store_idx ON fulfillment_service (store_id);
CREATE INDEX IF NOT EXISTS fulfillment_service_chain_idx ON fulfillment_service (chain_id) WHERE active;

-- -----------------------------------------------------------------------------

-- Bands over the basket subtotal, not a single number.
--
-- Real Israeli tariffs are step functions, and the steps are the interesting part:
-- Shufersal pickup is ₪15 up to ₪750 and ₪10 above it; Yango Deli is free at or
-- above ₪99 and unorderable below. Modelling the fee as one scalar loses the fact
-- that a shopper ₪20 short of a step can save money by spending more — which is
-- advice worth giving and which no shelf-price comparison can produce.
CREATE TABLE IF NOT EXISTS delivery_tariff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES fulfillment_service(id) ON DELETE CASCADE,

  -- standard | express | scheduled | pickup. Kept open rather than an enum: the
  -- shapes vary per retailer and a wrong enum forces data to be mangled to fit.
  slot_type text NOT NULL DEFAULT 'standard',

  -- Half-open band [min_subtotal, max_subtotal). NULLs are unbounded.
  min_subtotal numeric(12,2),
  max_subtotal numeric(12,2),
  fee numeric(12,2) NOT NULL,

  -- NULL = anyone. Otherwise the condition that unlocks this row: 'club' (chain
  -- loyalty), 'credit_card' (Rami Levy card holders kept the old rate), or a
  -- subscription like 'wolt_plus'. Mirrors how clubOnly/couponOnly prices are
  -- flagged rather than silently applied — the same mistake, one layer up.
  membership text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_tariff_fee_nonneg_check CHECK (fee >= 0),
  CONSTRAINT delivery_tariff_band_ordered_check
    CHECK (min_subtotal IS NULL OR max_subtotal IS NULL OR min_subtotal < max_subtotal)
);

COMMENT ON TABLE delivery_tariff IS
  'Delivery fee as bands over the basket subtotal. A band with fee 0 is a free-delivery threshold; a cheaper band above the current subtotal is a saving the shopper can reach by spending more.';

CREATE INDEX IF NOT EXISTS delivery_tariff_service_idx
  ON delivery_tariff (service_id, slot_type, min_subtotal);

-- -----------------------------------------------------------------------------

-- Where the service actually delivers.
--
-- Three shapes, because the retailers publish three shapes and flattening them
-- loses real information:
--   national  the whole country (with the settlement list unstated)
--   city      a named settlement — Rami Levy publishes exactly this, a list of
--             towns grouped by region, not geometry
--   radius    a point and a distance — the honest approximation for a regional
--             picking depot, and for a marketplace polygon we have not captured
--   polygon   GeoJSON, when the retailer publishes real geometry (Wolt does,
--             ~45 vertices per venue), tested point-in-polygon
CREATE TABLE IF NOT EXISTS delivery_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES fulfillment_service(id) ON DELETE CASCADE,

  scope text NOT NULL,
  -- Normalised city key (see normalizeCityKey in shared) so 'תל אביב', 'תל אביב-יפו'
  -- and 'Tel Aviv' all match one row.
  city_key text,
  center_lat double precision,
  center_lng double precision,
  radius_km double precision,
  geojson jsonb,

  -- Coverage is the most-guessed field here, so it carries its own confidence
  -- rather than inheriting the service's: a retailer can publish an exact fee and
  -- no service map at all.
  confidence text NOT NULL DEFAULT 'estimated',

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_coverage_scope_check
    CHECK (scope IN ('national', 'city', 'radius', 'polygon')),
  CONSTRAINT delivery_coverage_confidence_check
    CHECK (confidence IN ('verified', 'reported', 'estimated')),
  CONSTRAINT delivery_coverage_shape_check CHECK (
    (scope = 'national')
    OR (scope = 'city'   AND city_key IS NOT NULL)
    OR (scope = 'radius' AND center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_km IS NOT NULL)
    OR (scope = 'polygon' AND geojson IS NOT NULL)
  )
);

COMMENT ON TABLE delivery_coverage IS
  'Service area per fulfillment_service. A service with no rows at all serves nowhere known — the API reports that as unknown coverage, never as "delivers everywhere".';

CREATE INDEX IF NOT EXISTS delivery_coverage_service_idx ON delivery_coverage (service_id);
CREATE INDEX IF NOT EXISTS delivery_coverage_city_idx ON delivery_coverage (city_key) WHERE city_key IS NOT NULL;
