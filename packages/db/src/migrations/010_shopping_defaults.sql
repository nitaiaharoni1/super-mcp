-- Silent shopping defaults via ontology data (no matcher branches):
-- bare cola → regular beverage over candy/diet; ice → consumable bagged ice
-- over appliances, reusable whiskey accessories, popsicles, and ice cream.

-- 0) Explicit diet/zero intent must outrank an otherwise stronger regular match.
-- Ranking strength keeps this a preference; rejecting a missing value moves a
-- regular candidate to the relaxed tier instead of discarding it.
UPDATE semantic_attribute_definition
SET missing_value_behavior = 'reject'
WHERE ontology_version = 'he-retail-v1'
  AND attribute = 'variant';

-- 1) Beverage shopping concepts for cola surfaces.
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'concept', 'shopping', 'beverage', 'קולה'),
  ('he-retail-v1', 'concept', 'shopping', 'beverage', 'cola'),
  ('he-retail-v1', 'concept', 'shopping', 'beverage', 'קוקה קולה')
ON CONFLICT DO NOTHING;

-- 2) product_class=beverage on cola / soda surfaces.
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, match_mode, priority) VALUES
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'קולה', 'token', 0),
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'cola', 'token', 0),
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'קוקה', 'token', 0),
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'פפסי', 'token', 0),
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'sprite', 'token', 0),
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'ספרייט', 'token', 0)
ON CONFLICT DO NOTHING;

-- 3) Higher-priority class markers override incidental cola/ice tokens.
INSERT INTO semantic_term (
  ontology_version, kind, attribute, value, term, match_mode, priority
) VALUES
  ('he-retail-v1', 'attribute', 'product_class', 'candy', 'סוכריות', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'candy', 'סוכריה', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'candy', 'גומי', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'candy', 'מסטיק', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'appliance', 'מכונת קרח', 'phrase', 30),
  ('he-retail-v1', 'attribute', 'product_class', 'appliance', 'מכונה', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'accessory', 'קוביות קרח רב פעמיות', 'phrase', 40),
  ('he-retail-v1', 'attribute', 'product_class', 'accessory', 'קוביות קרח לוויסקי', 'phrase', 40),
  ('he-retail-v1', 'attribute', 'product_class', 'accessory', 'רב פעמיות', 'phrase', 30),
  ('he-retail-v1', 'attribute', 'product_class', 'accessory', 'וויסקי', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'accessory', 'לוויסקי', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'consumable_ice', 'שקית קרח', 'phrase', 30),
  ('he-retail-v1', 'attribute', 'product_class', 'consumable_ice', 'קוביות קרח', 'phrase', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'dessert', 'קרחון', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'dessert', 'גלידה', 'token', 20),
  ('he-retail-v1', 'attribute', 'product_class', 'dessert', 'גלידת', 'token', 20)
ON CONFLICT (ontology_version, kind, term, attribute, value) DO UPDATE SET
  match_mode = EXCLUDED.match_mode,
  priority = EXCLUDED.priority;

-- 4) Explicit variant=diet surfaces (honored when user asks for diet/zero/light).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, match_mode, priority) VALUES
  ('he-retail-v1', 'attribute', 'variant', 'diet', 'diet', 'token', 0),
  ('he-retail-v1', 'attribute', 'variant', 'diet', 'zero', 'token', 0),
  ('he-retail-v1', 'attribute', 'variant', 'diet', 'light', 'token', 0),
  ('he-retail-v1', 'attribute', 'variant', 'diet', 'דיאט', 'token', 0),
  ('he-retail-v1', 'attribute', 'variant', 'diet', 'זירו', 'token', 0),
  ('he-retail-v1', 'attribute', 'variant', 'diet', 'לייט', 'token', 0)
ON CONFLICT DO NOTHING;

-- 5) Soft penalties for diet/zero/light (ranking only; skipped when query mentions surface).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, weight) VALUES
  ('he-retail-v1', 'penalty', 'variant', 'diet', 'diet', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'diet', 'zero', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'diet', 'light', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'diet', 'דיאט', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'diet', 'זירו', 1.0),
  ('he-retail-v1', 'penalty', 'variant', 'diet', 'לייט', 1.0)
ON CONFLICT DO NOTHING;

-- 6) Cola query aliases (English + brand surfaces).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, match_mode, priority) VALUES
  ('he-retail-v1', 'alias', 'query', 'קולה', 'cola', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קולה', 'קולה', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קולה', 'קוקה קולה', 'alias', 0)
ON CONFLICT DO NOTHING;

-- 7) Bare ice means consumable ice. Specific product-class markers above win
-- for candidate names, keeping the default ontology-driven rather than coded.
INSERT INTO semantic_term (
  ontology_version, kind, attribute, value, term, implies_attribute, implies_value
) VALUES
  ('he-retail-v1', 'concept', 'shopping', 'ice', 'קרח', 'product_class', 'consumable_ice')
ON CONFLICT (ontology_version, kind, term, attribute, value) DO UPDATE SET
  implies_attribute = EXCLUDED.implies_attribute,
  implies_value = EXCLUDED.implies_value;

INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, match_mode, priority) VALUES
  ('he-retail-v1', 'alias', 'query', 'קרח', 'קרח', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קרח', 'שקית קרח', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קרח', 'קוביות קרח', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קרח', 'שקיות קרח', 'alias', 0)
ON CONFLICT DO NOTHING;

-- 8) Rebuild profiles so new class/penalty/variant surfaces apply to candidates.
INSERT INTO semantic_index_dirty (product_id, reason)
SELECT id, 'ontology_010_shopping_defaults'
FROM product
ON CONFLICT (product_id) DO UPDATE SET
  reason = EXCLUDED.reason,
  enqueued_at = now(),
  last_error = NULL;
