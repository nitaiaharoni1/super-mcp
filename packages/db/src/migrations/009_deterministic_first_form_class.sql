-- Deterministic-first basket resolution: form / product_class attributes,
-- processed-form surfaces, produce defaults, and search-config knobs.

-- 1) Attribute policy for form and product_class.
INSERT INTO semantic_attribute_definition (
  ontology_version, attribute, constraint_strength, missing_value_behavior,
  enables_nearby_alternative, conflict_policy
) VALUES
  ('he-retail-v1', 'form', 'hard', 'allow', false, 'different_value'),
  ('he-retail-v1', 'product_class', 'hard', 'allow', false, 'different_value')
ON CONFLICT (ontology_version, attribute) DO UPDATE SET
  constraint_strength = EXCLUDED.constraint_strength,
  missing_value_behavior = EXCLUDED.missing_value_behavior,
  enables_nearby_alternative = EXCLUDED.enables_nearby_alternative,
  conflict_policy = EXCLUDED.conflict_policy;

-- 2) Produce shopping concepts imply form=fresh (category default via ontology data).
UPDATE semantic_term
SET implies_attribute = 'form', implies_value = 'fresh'
WHERE ontology_version = 'he-retail-v1'
  AND kind = 'concept'
  AND attribute = 'shopping'
  AND value = 'produce'
  AND term IN ('מלפפון', 'עגבניה', 'בצל', 'לימון', 'חסה');

INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, implies_attribute, implies_value) VALUES
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'מלפפונים', 'form', 'fresh'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'עגבניות', 'form', 'fresh'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'עגבני', 'form', 'fresh'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'בצלים', 'form', 'fresh'),
  ('he-retail-v1', 'concept', 'shopping', 'produce', 'לימונים', 'form', 'fresh')
ON CONFLICT DO NOTHING;

-- 3) product_class=produce on bare produce surfaces (explicit attribute rows).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'מלפפון'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'מלפפונים'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'עגבניה'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'עגבניות'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'עגבני'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'בצל'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'בצלים'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'לימון'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'לימונים'),
  ('he-retail-v1', 'attribute', 'product_class', 'produce', 'חסה')
ON CONFLICT DO NOTHING;

-- 4) Form attribute surfaces (processed / prepared / dessert markers).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, match_mode, priority) VALUES
  ('he-retail-v1', 'attribute', 'form', 'pickled', 'במלח', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'pickled', 'כבוש', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'pickled', 'כבושים', 'token', 0),
  -- Note: חמוץ is intentionally not a hard form=pickled surface (matches sour candy/sauces).
  -- It remains a soft penalty term below.
  ('he-retail-v1', 'attribute', 'form', 'frozen', 'קפוא', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'frozen', 'קפואה', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'frozen', 'מוקפא', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'frozen', 'מוקפאה', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'prepared', 'נקניק', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'prepared', 'נקניקיות', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'prepared', 'פסטרמה', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'dessert', 'קרחון', 'token', 0),
  ('he-retail-v1', 'attribute', 'form', 'dessert', 'גלידה', 'token', 0)
ON CONFLICT DO NOTHING;

-- 5) product_class=beverage markers (liquor / wine class).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term) VALUES
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'ליקר'),
  ('he-retail-v1', 'attribute', 'product_class', 'beverage', 'יין')
ON CONFLICT DO NOTHING;

-- 5b) Plural / shopping-form aliases → singular catalog forms (query expansion).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, match_mode, priority) VALUES
  ('he-retail-v1', 'alias', 'query', 'בצל', 'בצלים', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'בצל', 'בצל', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'מלפפון', 'מלפפונים', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'מלפפון', 'מלפפון', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'לימון', 'לימונים', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'לימון', 'לימון', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'עגבניה', 'עגבניות', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'עגבניה', 'עגבניה', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'פלפל', 'פלפלים', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'פלפל', 'פלפל', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קבב', 'קבבים', 'alias', 0),
  ('he-retail-v1', 'alias', 'query', 'קבב', 'קבב', 'alias', 0)
ON CONFLICT DO NOTHING;

-- 6) Soft penalties for processed-form lookalikes (ranking only; gate uses hard form attrs).
INSERT INTO semantic_term (ontology_version, kind, attribute, value, term, weight) VALUES
  ('he-retail-v1', 'penalty', 'form', 'pickled', 'במלח', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'pickled', 'כבוש', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'pickled', 'חמוץ', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'frozen', 'קפוא', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'frozen', 'מוקפא', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'prepared', 'נקניק', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'prepared', 'נקניקיות', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'prepared', 'פסטרמה', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'dessert', 'קרחון', 1.0),
  ('he-retail-v1', 'penalty', 'form', 'dessert', 'גלידה', 1.0),
  ('he-retail-v1', 'penalty', 'product_class', 'beverage', 'ליקר', 1.0)
ON CONFLICT DO NOTHING;

-- 7) Merge deterministic-first search config keys (preserve existing values).
UPDATE semantic_search_config
SET config = config || '{
  "firstPassLexicalLimit": 20,
  "embeddingFallbackLimit": 15,
  "minSafeResolutionRatio": 0.7,
  "substitutionMinConfidence": 0.25,
  "requireDeterministicForAutoResolve": true
}'::jsonb,
    updated_at = now()
WHERE ontology_version = 'he-retail-v1';

INSERT INTO semantic_search_config (ontology_version, config)
SELECT
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
    "minProfileCoverage": 0.1,
    "firstPassLexicalLimit": 20,
    "embeddingFallbackLimit": 15,
    "minSafeResolutionRatio": 0.7,
    "substitutionMinConfidence": 0.25,
    "requireDeterministicForAutoResolve": true
  }'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM semantic_search_config WHERE ontology_version = 'he-retail-v1'
);

-- Existing profiles were generated before form/class terms existed. Rebuild
-- them so stored profiles and current ontology policy cannot drift apart.
INSERT INTO semantic_index_dirty (product_id, reason)
SELECT id, 'ontology_009_form_class'
FROM product
ON CONFLICT (product_id) DO UPDATE SET
  reason = EXCLUDED.reason,
  enqueued_at = now(),
  last_error = NULL;
