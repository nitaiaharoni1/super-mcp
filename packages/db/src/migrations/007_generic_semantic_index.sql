-- Generic semantic index: versioned ontology, composite model embeddings,
-- precomputed product profiles, and dirty-queue invalidation.

-- 1) product_embedding: allow multiple model generations per product.
ALTER TABLE product_embedding DROP CONSTRAINT IF EXISTS product_embedding_pkey;
ALTER TABLE product_embedding
  ADD CONSTRAINT product_embedding_pkey PRIMARY KEY (product_id, model);

CREATE INDEX IF NOT EXISTS product_embedding_model_only_idx
  ON product_embedding (model);

-- 2) Ontology version + terms (Hebrew retail knowledge as data).
CREATE TABLE IF NOT EXISTS semantic_ontology_version (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL DEFAULT 'he',
  active BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semantic_term (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ontology_version TEXT NOT NULL REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('concept', 'attribute', 'alias', 'stopword', 'penalty')),
  attribute TEXT,
  value TEXT,
  term TEXT NOT NULL,
  implies_attribute TEXT,
  implies_value TEXT,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ontology_version, kind, term, attribute, value)
);

CREATE INDEX IF NOT EXISTS semantic_term_lookup_idx
  ON semantic_term (ontology_version, lower(term));

CREATE TABLE IF NOT EXISTS semantic_relaxation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ontology_version TEXT NOT NULL REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,
  from_value TEXT NOT NULL,
  to_value TEXT NOT NULL,
  label TEXT,
  UNIQUE (ontology_version, attribute, from_value, to_value)
);

CREATE TABLE IF NOT EXISTS product_semantic_profile (
  product_id UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  ontology_version TEXT NOT NULL REFERENCES semantic_ontology_version(id) ON DELETE CASCADE,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  concepts TEXT[] NOT NULL DEFAULT '{}',
  input_hash TEXT NOT NULL,
  profiled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, ontology_version)
);

CREATE INDEX IF NOT EXISTS product_semantic_profile_attrs_gin
  ON product_semantic_profile USING gin (attributes);

-- 3) Dirty queue for precompute-on-change.
CREATE TABLE IF NOT EXISTS semantic_index_dirty (
  product_id UUID PRIMARY KEY REFERENCES product(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE OR REPLACE FUNCTION enqueue_semantic_index_dirty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pid UUID;
  why TEXT;
BEGIN
  IF TG_TABLE_NAME = 'product' THEN
    pid := NEW.id;
    why := TG_OP || ':product';
  ELSIF TG_TABLE_NAME = 'listing' THEN
    pid := NEW.product_id;
    why := TG_OP || ':listing';
  ELSE
    RETURN NEW;
  END IF;

  IF pid IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO semantic_index_dirty (product_id, reason)
  VALUES (pid, why)
  ON CONFLICT (product_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    enqueued_at = now(),
    last_error = NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_semantic_dirty_trg ON product;
CREATE TRIGGER product_semantic_dirty_trg
  AFTER INSERT OR UPDATE OF name, brand ON product
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_semantic_index_dirty();

DROP TRIGGER IF EXISTS listing_semantic_dirty_trg ON listing;
CREATE TRIGGER listing_semantic_dirty_trg
  AFTER INSERT OR UPDATE OF name, product_id ON listing
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_semantic_index_dirty();

-- 4) Seed active Hebrew retail ontology.
INSERT INTO semantic_ontology_version (id, locale, active, notes)
VALUES ('he-retail-v1', 'he', true, 'Initial data-driven Hebrew retail ontology')
ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active;

-- Freshness
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'attribute', 'freshness', 'fresh', 'טרי'),
  ('he-retail-v1', 'attribute', 'freshness', 'fresh', 'טריה'),
  ('he-retail-v1', 'attribute', 'freshness', 'fresh', 'טריים'),
  ('he-retail-v1', 'attribute', 'freshness', 'fresh', 'טריות'),
  ('he-retail-v1', 'attribute', 'freshness', 'fresh', 'fresh'),
  ('he-retail-v1', 'attribute', 'freshness', 'frozen', 'קפוא'),
  ('he-retail-v1', 'attribute', 'freshness', 'frozen', 'קפואה'),
  ('he-retail-v1', 'attribute', 'freshness', 'frozen', 'קפואים'),
  ('he-retail-v1', 'attribute', 'freshness', 'frozen', 'קפואות'),
  ('he-retail-v1', 'attribute', 'freshness', 'frozen', 'frozen')
ON CONFLICT DO NOTHING;

-- Species
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'attribute', 'species', 'chicken', 'עוף'),
  ('he-retail-v1', 'attribute', 'species', 'chicken', 'עופות'),
  ('he-retail-v1', 'attribute', 'species', 'chicken', 'chicken'),
  ('he-retail-v1', 'attribute', 'species', 'turkey', 'הודו'),
  ('he-retail-v1', 'attribute', 'species', 'turkey', 'turkey'),
  ('he-retail-v1', 'attribute', 'species', 'beef', 'בקר'),
  ('he-retail-v1', 'attribute', 'species', 'beef', 'עגל'),
  ('he-retail-v1', 'attribute', 'species', 'beef', 'beef'),
  ('he-retail-v1', 'attribute', 'species', 'lamb', 'כבש'),
  ('he-retail-v1', 'attribute', 'species', 'lamb', 'טלה'),
  ('he-retail-v1', 'attribute', 'species', 'lamb', 'lamb'),
  ('he-retail-v1', 'attribute', 'species', 'fish', 'דג'),
  ('he-retail-v1', 'attribute', 'species', 'fish', 'דגים'),
  ('he-retail-v1', 'attribute', 'species', 'fish', 'סלמון'),
  ('he-retail-v1', 'attribute', 'species', 'fish', 'טונה'),
  ('he-retail-v1', 'attribute', 'species', 'fish', 'fish')
ON CONFLICT DO NOTHING;

-- Cuts (+ implications)
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, implies_attribute, implies_value) VALUES
  ('he-retail-v1', 'attribute', 'cut', 'thighs', 'פרגיות', 'species', 'chicken'),
  ('he-retail-v1', 'attribute', 'cut', 'thighs', 'פרגית', 'species', 'chicken'),
  ('he-retail-v1', 'attribute', 'cut', 'thighs', 'ירכיים', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'thighs', 'ירך', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'breast', 'חזה', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'schnitzel', 'שניצל', 'species', 'chicken'),
  ('he-retail-v1', 'attribute', 'cut', 'wings', 'כנפיים', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'wings', 'כנף', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'ground', 'טחון', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'ground', 'טחונה', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'kabab', 'קבב', NULL, NULL),
  ('he-retail-v1', 'attribute', 'cut', 'kabab', 'קציצות', NULL, NULL)
ON CONFLICT DO NOTHING;

-- Kosher / brands
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'attribute', 'kosher', 'true', 'כשר'),
  ('he-retail-v1', 'attribute', 'kosher', 'true', 'בדץ'),
  ('he-retail-v1', 'attribute', 'kosher', 'true', 'מהדרין'),
  ('he-retail-v1', 'attribute', 'brand', 'תנובה', 'תנובה'),
  ('he-retail-v1', 'attribute', 'brand', 'יטבתה', 'יטבתה'),
  ('he-retail-v1', 'attribute', 'brand', 'טרה', 'טרה'),
  ('he-retail-v1', 'attribute', 'brand', 'שטראוס', 'שטראוס'),
  ('he-retail-v1', 'attribute', 'brand', 'אסם', 'אסם'),
  ('he-retail-v1', 'attribute', 'brand', 'עלית', 'עלית'),
  ('he-retail-v1', 'attribute', 'brand', 'ויליפוד', 'ויליפוד'),
  ('he-retail-v1', 'attribute', 'brand', 'טבעול', 'טבעול'),
  ('he-retail-v1', 'attribute', 'brand', 'זוגלובק', 'זוגלובק'),
  ('he-retail-v1', 'attribute', 'brand', 'עוף טוב', 'עוף טוב')
ON CONFLICT DO NOTHING;

-- Soft penalties (variant / multipack noise) — never hard-reject.
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, weight) VALUES
  ('he-retail-v1', 'penalty', 'variant', 'spicy', 'חריף', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'spicy', 'פיקנטי', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'zaatar', 'זעתר', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'matbucha', 'מטבוחה', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'eggplant', 'חציל', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'mesabcha', 'מסבחה', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'mexican', 'מקסיקני', 1.0),
  ('he-retail-v1', 'penalty', 'pack', 'multipack', 'שישייה', 1.0),
  ('he-retail-v1', 'penalty', 'pack', 'multipack', 'שישיה', 1.0),
  ('he-retail-v1', 'penalty', 'pack', 'multipack', 'רביעייה', 1.0),
  ('he-retail-v1', 'penalty', 'pack', 'multipack', 'מארז', 0.5)
ON CONFLICT DO NOTHING;

-- Query aliases (canonical value + surface term)
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'alias', 'query', 'פרגיות', 'פרגיות'),
  ('he-retail-v1', 'alias', 'query', 'פרגיות', 'פרגית'),
  ('he-retail-v1', 'alias', 'query', 'פרגיות', 'ירכיים עוף'),
  ('he-retail-v1', 'alias', 'query', 'חזה עוף', 'חזה עוף'),
  ('he-retail-v1', 'alias', 'query', 'שניצל', 'שניצל'),
  ('he-retail-v1', 'alias', 'query', 'קבב', 'קבב'),
  ('he-retail-v1', 'alias', 'query', 'טחון', 'טחון'),
  ('he-retail-v1', 'alias', 'query', 'טחון', 'בשר טחון'),
  ('he-retail-v1', 'alias', 'query', 'חלב', 'חלב'),
  ('he-retail-v1', 'alias', 'query', 'קוטג', 'קוטג'),
  ('he-retail-v1', 'alias', 'query', 'קוטג', 'קוטג׳'),
  ('he-retail-v1', 'alias', 'query', 'לחם', 'לחם'),
  ('he-retail-v1', 'alias', 'query', 'פיתה', 'פיתה'),
  ('he-retail-v1', 'alias', 'query', 'פיתה', 'פיתות'),
  ('he-retail-v1', 'alias', 'query', 'חומוס', 'חומוס'),
  ('he-retail-v1', 'alias', 'query', 'ביצים', 'ביצים'),
  ('he-retail-v1', 'alias', 'query', 'שמן זית', 'שמן זית')
ON CONFLICT DO NOTHING;

-- Concepts (shopping intents that enable nearby-alternative tier)
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'concept', 'shopping', 'thighs', 'פרגיות'),
  ('he-retail-v1', 'concept', 'shopping', 'thighs', 'פרגית'),
  ('he-retail-v1', 'concept', 'shopping', 'breast', 'חזה'),
  ('he-retail-v1', 'concept', 'shopping', 'ground', 'טחון'),
  ('he-retail-v1', 'concept', 'shopping', 'wings', 'כנפיים'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'בננה'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'עגבניה'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'מלפפון'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'תפוח'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'בצל'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'שום'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'לימון'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'פטריות'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'חסה')
ON CONFLICT DO NOTHING;

INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'טרי'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'קפוא'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'ארוז'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'לקג'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'קג'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'ק"ג'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'kg'),
  ('he-retail-v1', 'stopword', 'token', 'ignore', 'g')
ON CONFLICT DO NOTHING;

-- Configured soft relaxations (replaces hardcoded breast↔ schnitzel).
INSERT INTO semantic_relaxation (ontology_version, attribute, from_value, to_value, label) VALUES
  ('he-retail-v1', 'cut', 'breast', 'schnitzel', 'cut:breast_schnitzel'),
  ('he-retail-v1', 'cut', 'schnitzel', 'breast', 'cut:breast_schnitzel'),
  ('he-retail-v1', 'kosher', 'true', 'unmarked', 'kosher:unmarked')
ON CONFLICT DO NOTHING;

-- Migrate alias-only product_alias rows into ontology aliases (idempotent).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term)
SELECT 'he-retail-v1', 'alias', 'query', pa.alias, pa.alias
FROM product_alias pa
WHERE pa.product_id IS NULL
ON CONFLICT DO NOTHING;

-- Note: do not mass-enqueue every product here. Run
--   pnpm db:semantic-index -- --backend=hasher   (or transformers)
-- for the initial backfill. Triggers keep the dirty queue warm afterward.
