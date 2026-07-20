-- Some feeds put a bare "0" in <City> as a null placeholder. canonicalizeCity
-- now drops it on write, but existing rows still carry the literal city "0",
-- which pollutes city filters and match_miss proposals and can never resolve to
-- a centroid. Null it out so these stores read as genuinely city-unknown.
-- Coordinates are untouched (they are already NULL for these rows).
UPDATE store
SET city = NULL,
    updated_at = now()
WHERE city ~ '^0+$';
