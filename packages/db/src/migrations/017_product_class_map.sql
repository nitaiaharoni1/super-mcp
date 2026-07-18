-- One-time LLM product classification (L1/L2/L3), kept OUTSIDE
-- product_semantic_profile so a reingest / ontology bump never wipes it.
-- The request path only READS this table; classification is always offline.
CREATE TABLE IF NOT EXISTS product_class_map (
  product_id    uuid PRIMARY KEY REFERENCES product(id) ON DELETE CASCADE,
  class_l1      text NOT NULL,
  class_l2      text,
  class_l3      text,
  confidence    real,
  source        text NOT NULL DEFAULT 'llm',
  model         text,
  -- product name at classification time; a later rename makes the row stale
  -- (input_name <> product.name) so the incremental run re-queues it.
  input_name    text NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_class_map_l1_l2_idx
  ON product_class_map (class_l1, class_l2);
