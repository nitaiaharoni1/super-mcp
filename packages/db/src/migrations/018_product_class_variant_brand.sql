-- Two cross-cutting labels the 3-level class tree can't express:
--   variant        — regular/diet_zero/cherry_grape/organic/... (same L3, not a
--                    substitute). A generic line defaults to 'regular'.
--   brand_extracted — brand pulled from the product NAME by the classifier, to
--                    fill the 67% of the catalog where product.brand is NULL.
-- Both live on the existing offline map; read-only at request time.
ALTER TABLE product_class_map
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS brand_extracted text;

CREATE INDEX IF NOT EXISTS product_class_map_l3_variant_idx
  ON product_class_map (class_l3, variant);
