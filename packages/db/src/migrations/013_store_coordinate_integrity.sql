-- Store coordinates are optional, but a populated pair must describe a point
-- inside the supported Israel region. Null both values when historical feeds
-- supplied zeroes, partial pairs, global outliers, or non-Israel coordinates.
UPDATE store
SET lat = NULL,
    lng = NULL,
    updated_at = now()
WHERE
  (lat IS NULL) <> (lng IS NULL)
  OR (
    lat IS NOT NULL
    AND lng IS NOT NULL
    AND NOT (
      lat BETWEEN 29 AND 34
      AND lng BETWEEN 34 AND 36
      AND lat <> 0
      AND lng <> 0
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_coordinates_valid_check'
      AND conrelid = 'store'::regclass
  ) THEN
    ALTER TABLE store
      ADD CONSTRAINT store_coordinates_valid_check
      CHECK (
        (lat IS NULL AND lng IS NULL)
        OR (
          lat IS NOT NULL
          AND lng IS NOT NULL
          AND lat BETWEEN 29 AND 34
          AND lng BETWEEN 34 AND 36
          AND lat <> 0
          AND lng <> 0
        )
      );
  END IF;
END
$$;
