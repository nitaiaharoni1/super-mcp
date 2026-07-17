-- Capture open-world inputs our closed lists missed (promo regexes, unit
-- aliases, region city list, ontology terms). Feeds the offline growth loop.
CREATE TABLE IF NOT EXISTS match_miss (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  term TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  hit_count BIGINT NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, term)
);

CREATE INDEX IF NOT EXISTS match_miss_kind_count_idx
  ON match_miss (kind, hit_count DESC);
