-- super_mcp canonical schema (SPEC v1)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chain (
  id TEXT PRIMARY KEY,              -- legal chain barcode e.g. 7290027600007
  source_id TEXT NOT NULL,          -- adapter source e.g. il-shufersal
  market TEXT NOT NULL DEFAULT 'IL',
  name_he TEXT NOT NULL,
  name_en TEXT,
  currency TEXT NOT NULL DEFAULT 'ILS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id TEXT NOT NULL REFERENCES chain(id),
  store_code TEXT NOT NULL,         -- chain-local store id
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  zip TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, store_code)
);

CREATE INDEX IF NOT EXISTS store_city_idx ON store (city);
CREATE INDEX IF NOT EXISTS store_chain_idx ON store (chain_id);
CREATE INDEX IF NOT EXISTS store_city_trgm ON store USING gin (city gin_trgm_ops);

CREATE TABLE IF NOT EXISTS product (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gtin TEXT UNIQUE,                 -- null for non-GTIN; see 002_non_gtin_products (source_key)
  name TEXT NOT NULL,
  brand TEXT,
  category_l1 TEXT,
  category_l2 TEXT,
  size_qty DOUBLE PRECISION,
  size_unit TEXT,                   -- g|ml|unit
  search_vector tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_gtin_idx ON product (gtin);
CREATE INDEX IF NOT EXISTS product_brand_idx ON product (brand);
CREATE INDEX IF NOT EXISTS product_name_trgm ON product USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_search_idx ON product USING gin (search_vector);

CREATE TABLE IF NOT EXISTS listing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES product(id),
  chain_id TEXT NOT NULL REFERENCES chain(id),
  item_code TEXT NOT NULL,
  item_type INT NOT NULL DEFAULT 1,
  is_gtin BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  brand TEXT,
  qty DOUBLE PRECISION,
  unit TEXT,
  canonical_qty DOUBLE PRECISION,
  canonical_unit TEXT,
  measure_unparseable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, item_code)
);

CREATE INDEX IF NOT EXISTS listing_product_idx ON listing (product_id);
CREATE INDEX IF NOT EXISTS listing_name_trgm ON listing USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS store_price (
  listing_id UUID NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
  price NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(12, 4),        -- recomputed per 100g/100ml/unit
  currency TEXT NOT NULL DEFAULT 'ILS',
  allow_discount BOOLEAN,
  source_ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, store_id)
);

CREATE INDEX IF NOT EXISTS store_price_store_idx ON store_price (store_id);
CREATE INDEX IF NOT EXISTS store_price_source_ts_idx ON store_price (source_ts);

-- Append-only history (monthly partitions created lazily by app if needed)
CREATE TABLE IF NOT EXISTS price_point (
  id BIGSERIAL,
  listing_id UUID NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
  price NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(12, 4),
  currency TEXT NOT NULL DEFAULT 'ILS',
  source_ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, source_ts)
) PARTITION BY RANGE (source_ts);

CREATE TABLE IF NOT EXISTS price_point_default PARTITION OF price_point DEFAULT;

CREATE INDEX IF NOT EXISTS price_point_lookup_idx
  ON price_point (listing_id, store_id, source_ts DESC);

CREATE TABLE IF NOT EXISTS promotion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id TEXT NOT NULL REFERENCES chain(id),
  store_id UUID REFERENCES store(id),
  store_code TEXT,
  promo_code TEXT NOT NULL,
  description TEXT NOT NULL,
  mechanic_type TEXT NOT NULL,
  mechanic_params JSONB NOT NULL DEFAULT '{}',
  raw_text TEXT,
  club_only BOOLEAN NOT NULL DEFAULT false,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  source_ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, store_code, promo_code)
);

CREATE INDEX IF NOT EXISTS promotion_active_idx ON promotion (start_ts, end_ts);
CREATE INDEX IF NOT EXISTS promotion_store_idx ON promotion (store_id);

CREATE TABLE IF NOT EXISTS promotion_item (
  promotion_id UUID NOT NULL REFERENCES promotion(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  listing_id UUID REFERENCES listing(id),
  PRIMARY KEY (promotion_id, item_code)
);

CREATE TABLE IF NOT EXISTS api_key (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usage_event (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES api_key(id),
  route TEXT NOT NULL,
  status_code INT NOT NULL,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_event_key_idx ON usage_event (api_key_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_run (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running|success|degraded|failed|empty
  files_discovered INT NOT NULL DEFAULT 0,
  files_processed INT NOT NULL DEFAULT 0,
  rows_ok INT NOT NULL DEFAULT 0,
  rows_error INT NOT NULL DEFAULT 0,
  error_summary TEXT,
  report JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS ingestion_run_source_idx ON ingestion_run (source_id, started_at DESC);

-- Keep search_vector in sync
CREATE OR REPLACE FUNCTION product_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.gtin, '')), 'A');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_search_vector_trg ON product;
CREATE TRIGGER product_search_vector_trg
  BEFORE INSERT OR UPDATE OF name, brand, gtin ON product
  FOR EACH ROW EXECUTE FUNCTION product_search_vector_update();
