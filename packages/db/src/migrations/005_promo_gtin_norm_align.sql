-- Fix item_code_norm to match normalizeGtin: strip leading zeros only when
-- the *post-strip* digit string is still >= 8 chars (e.g. 00001234 stays padded).

UPDATE promotion_item
SET item_code_norm = CASE
  WHEN length(regexp_replace(regexp_replace(item_code, '\D', '', 'g'), '^0+', '')) >= 8
    THEN regexp_replace(regexp_replace(item_code, '\D', '', 'g'), '^0+', '')
  ELSE regexp_replace(item_code, '\D', '', 'g')
END;
