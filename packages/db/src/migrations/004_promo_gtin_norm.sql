-- Align promotion_item.item_code_norm with listing GTIN keys (normalizeGtin):
-- digits only, then strip leading zeros when the *post-strip* length is still >= 8.
-- (Superseded edge-case fix in 005_promo_gtin_norm_align.sql for already-applied envs.)

UPDATE promotion_item
SET item_code_norm = CASE
  WHEN length(regexp_replace(regexp_replace(item_code, '\D', '', 'g'), '^0+', '')) >= 8
    THEN regexp_replace(regexp_replace(item_code, '\D', '', 'g'), '^0+', '')
  ELSE regexp_replace(item_code, '\D', '', 'g')
END;

CREATE INDEX IF NOT EXISTS promotion_item_code_norm_idx ON promotion_item (item_code_norm)
  WHERE item_code_norm <> '';
