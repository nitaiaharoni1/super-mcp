-- Privacy-safe persistent cache for free-text user location geocoding.
-- Raw addresses are never stored: query_key is HMAC-SHA256(normalized_query, secret).

CREATE TABLE IF NOT EXISTS geocode_cache (
  query_key TEXT PRIMARY KEY,
  -- Non-sensitive display label from the provider (or null for negative cache).
  display_name TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  precision TEXT CHECK (
    precision IS NULL
    OR precision IN ('address', 'street', 'neighborhood', 'city')
  ),
  provider TEXT NOT NULL CHECK (provider IN ('nominatim', 'city_centroid')),
  -- hit = positive result; miss = confirmed empty result (negative cache).
  status TEXT NOT NULL CHECK (status IN ('hit', 'miss')),
  expires_at TIMESTAMPTZ NOT NULL,
  hits BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'miss' AND lat IS NULL AND lng IS NULL AND precision IS NULL)
    OR (status = 'hit' AND lat IS NOT NULL AND lng IS NOT NULL AND precision IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS geocode_cache_expires_at_idx
  ON geocode_cache (expires_at);
