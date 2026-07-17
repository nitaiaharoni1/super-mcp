-- Semantic Retrieval V2: attribute policy, match modes, full profiles,
-- query embedding cache, and versioned search configuration.

-- 1) Generic attribute policy (no engine branches on attribute names).
CREATE TABLE IF NOT EXISTS semantic_attribute_definition (
  ontology_version TEXT NOT NULL REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,
  constraint_strength TEXT NOT NULL CHECK (constraint_strength IN ('hard', 'soft', 'ranking')),
  missing_value_behavior TEXT NOT NULL CHECK (missing_value_behavior IN ('allow', 'relax', 'reject')),
  enables_nearby_alternative BOOLEAN NOT NULL DEFAULT false,
  conflict_policy TEXT NOT NULL CHECK (conflict_policy IN ('different_value', 'explicit_pairs')),
  PRIMARY KEY (ontology_version, attribute)
);

-- 2) Match modes + priority on terms.
ALTER TABLE semantic_term
  ADD COLUMN IF NOT EXISTS match_mode TEXT NOT NULL DEFAULT 'token'
    CHECK (match_mode IN ('token', 'phrase', 'exact', 'alias')),
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;

-- 3) Complete persisted profiles.
ALTER TABLE product_semantic_profile
  ADD COLUMN IF NOT EXISTS penalties TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS concept_terms TEXT[] NOT NULL DEFAULT '{}';

-- 4) Cached query embeddings (API reads; embed on cache miss).
CREATE TABLE IF NOT EXISTS semantic_query_embedding (
  query_hash TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (query_hash, model)
);

CREATE INDEX IF NOT EXISTS semantic_query_embedding_model_idx
  ON semantic_query_embedding (model);

-- 5) Versioned search config (thresholds out of SQL/code).
CREATE TABLE IF NOT EXISTS semantic_search_config (
  ontology_version TEXT PRIMARY KEY REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed attribute definitions for he-retail-v1 (data, not engine code).
INSERT INTO semantic_attribute_definition (
  ontology_version, attribute, constraint_strength, missing_value_behavior,
  enables_nearby_alternative, conflict_policy
) VALUES
  ('he-retail-v1', 'freshness', 'hard', 'allow', false, 'different_value'),
  ('he-retail-v1', 'species', 'hard', 'allow', true, 'different_value'),
  ('he-retail-v1', 'cut', 'hard', 'allow', true, 'different_value'),
  ('he-retail-v1', 'brand', 'hard', 'reject', false, 'different_value'),
  ('he-retail-v1', 'kosher', 'soft', 'relax', false, 'different_value'),
  ('he-retail-v1', 'variant', 'ranking', 'allow', false, 'different_value'),
  ('he-retail-v1', 'pack', 'ranking', 'allow', false, 'different_value')
ON CONFLICT (ontology_version, attribute) DO UPDATE SET
  constraint_strength = EXCLUDED.constraint_strength,
  missing_value_behavior = EXCLUDED.missing_value_behavior,
  enables_nearby_alternative = EXCLUDED.enables_nearby_alternative,
  conflict_policy = EXCLUDED.conflict_policy;

-- Phrase match for multi-word brands / aliases; aliases keep alias mode.
UPDATE semantic_term
SET match_mode = 'phrase', priority = 10
WHERE ontology_version = 'he-retail-v1'
  AND kind = 'attribute'
  AND attribute = 'brand'
  AND term LIKE '% %';

UPDATE semantic_term
SET match_mode = 'alias', priority = 0
WHERE ontology_version = 'he-retail-v1'
  AND kind = 'alias';

UPDATE semantic_term
SET match_mode = 'phrase', priority = 5
WHERE ontology_version = 'he-retail-v1'
  AND kind = 'attribute'
  AND position(' ' in term) > 0
  AND match_mode = 'token';

INSERT INTO semantic_search_config (ontology_version, config) VALUES (
  'he-retail-v1',
  '{
    "vectorLimit": 40,
    "vectorDistanceMax": 0.45,
    "lexicalLimit": 60,
    "trigramThreshold": 0.4,
    "vectorRrfWeight": 1.0,
    "lexicalRrfWeight": 1.0,
    "rrfK": 60,
    "autoAcceptScore": 0.55,
    "autoAcceptGap": 0.15,
    "nearbyAlternativesEnabled": true,
    "minProfileCoverage": 0.1
  }'::jsonb
)
ON CONFLICT (ontology_version) DO UPDATE SET
  config = EXCLUDED.config,
  updated_at = now();
