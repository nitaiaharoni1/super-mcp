-- Semantic product index: pgvector embeddings + shopping-term aliases.
-- Embeddings are written by an offline batch job; API only reads them.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_embedding (
  product_id UUID PRIMARY KEY REFERENCES product(id) ON DELETE CASCADE,
  embedding vector(384) NOT NULL,
  model TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  dims INT NOT NULL DEFAULT 384,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_embedding_hnsw
  ON product_embedding
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS product_embedding_model_idx
  ON product_embedding (model);

CREATE TABLE IF NOT EXISTS product_alias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES product(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'he',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias, product_id)
);

-- Alias-only rows (product_id NULL) expand query terms before lexical search.
CREATE UNIQUE INDEX IF NOT EXISTS product_alias_query_unique
  ON product_alias (alias)
  WHERE product_id IS NULL;

CREATE INDEX IF NOT EXISTS product_alias_trgm
  ON product_alias USING gin (alias gin_trgm_ops);

-- Common Hebrew shopping synonyms → expand free-text queries (no product_id).
INSERT INTO product_alias (alias, locale, source) VALUES
  ('פרגיות', 'he', 'seed'),
  ('פרגית', 'he', 'seed'),
  ('חזה עוף', 'he', 'seed'),
  ('שניצל', 'he', 'seed'),
  ('קבב', 'he', 'seed'),
  ('טחון', 'he', 'seed'),
  ('בשר טחון', 'he', 'seed'),
  ('חלב', 'he', 'seed'),
  ('קוטג', 'he', 'seed'),
  ('קוטג׳', 'he', 'seed'),
  ('לחם', 'he', 'seed'),
  ('פיתות', 'he', 'seed'),
  ('פיתה', 'he', 'seed'),
  ('חומוס', 'he', 'seed'),
  ('ביצים', 'he', 'seed'),
  ('שמן זית', 'he', 'seed')
ON CONFLICT DO NOTHING;
