-- Cross-cutting product attributes: preparation and pack form.
--
-- class_l3 was meant to separate a staple from things made out of it, but it is
-- populated for only 22,182 of 118,156 stocked products. The gap is why a plain
-- "אורז" query could resolve to rice paper or rice noodles, and "יוגורט" to a
-- chocolate-cornflake snack pot: every candidate shares the staple's token and its
-- l1/l2, and nothing in the data says which one IS the staple.
--
-- The workaround has been hand-tuned Hebrew token deny-lists. Those carry a
-- standing false-positive risk that has already bitten twice: one iteration of the
-- roll-count guard gave "חלה קלועה אנגל 650 ג" a pack count of 650, and 196 of its
-- 255 catalog matches were wrong. These two columns replace inference from names
-- with a labelled fact.
--
--   preparation: plain | flavoured | prepared_meal | derived_ingredient
--   pack_form:   single | multipack
--
-- Both are NULLABLE on purpose. NULL means "not yet classified" and every consumer
-- must treat it as unknown rather than as a default, so a partially-classified
-- catalog degrades to today's behaviour instead of silently mislabelling.

ALTER TABLE product_class_map ADD COLUMN IF NOT EXISTS preparation text;
ALTER TABLE product_class_map ADD COLUMN IF NOT EXISTS pack_form text;

COMMENT ON COLUMN product_class_map.preparation IS
  'plain | flavoured | prepared_meal | derived_ingredient. NULL = unclassified, treat as unknown.';
COMMENT ON COLUMN product_class_map.pack_form IS
  'single | multipack. NULL = unclassified, treat as unknown.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_class_map_preparation_check') THEN
    ALTER TABLE product_class_map ADD CONSTRAINT product_class_map_preparation_check
      CHECK (preparation IS NULL
             OR preparation IN ('plain', 'flavoured', 'prepared_meal', 'derived_ingredient'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_class_map_pack_form_check') THEN
    ALTER TABLE product_class_map ADD CONSTRAINT product_class_map_pack_form_check
      CHECK (pack_form IS NULL OR pack_form IN ('single', 'multipack'));
  END IF;
END $$;

-- Equivalence filters by (class_l2, preparation) when deciding whether two SKUs are
-- the same basket line, so index that pair.
CREATE INDEX IF NOT EXISTS product_class_map_l2_preparation_idx
  ON product_class_map (class_l2, preparation);
