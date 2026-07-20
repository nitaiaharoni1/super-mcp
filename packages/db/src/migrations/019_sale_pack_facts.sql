-- Durable pack/sale facts so runtime equivalence does not rely only on
-- inconsistent size_qty/size_unit. Feed bIsWeighted and multipack piece counts
-- were previously discarded after ingest-time normalizeMeasure.
--
-- listing: per-SKU sale basis (weighted produce vs piece vs multipack).
-- product: optional rollup helpers for the shared product identity.

ALTER TABLE listing
  ADD COLUMN IF NOT EXISTS is_weighted boolean,
  ADD COLUMN IF NOT EXISTS sale_basis text,
  ADD COLUMN IF NOT EXISTS piece_count double precision,
  ADD COLUMN IF NOT EXISTS measure_source text,
  ADD COLUMN IF NOT EXISTS measure_confidence real;

ALTER TABLE product
  ADD COLUMN IF NOT EXISTS piece_count double precision,
  ADD COLUMN IF NOT EXISTS pack_metadata_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'listing'::regclass AND conname = 'listing_sale_basis_check'
  ) THEN
    ALTER TABLE listing
      ADD CONSTRAINT listing_sale_basis_check
      CHECK (
        sale_basis IS NULL
        OR sale_basis IN ('per_kg', 'per_l', 'per_piece', 'per_pack', 'unknown')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'listing'::regclass AND conname = 'listing_measure_source_check'
  ) THEN
    ALTER TABLE listing
      ADD CONSTRAINT listing_measure_source_check
      CHECK (
        measure_source IS NULL
        OR measure_source IN ('feed', 'name_inferred', 'weighted_default', 'unknown')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'listing'::regclass AND conname = 'listing_measure_confidence_check'
  ) THEN
    ALTER TABLE listing
      ADD CONSTRAINT listing_measure_confidence_check
      CHECK (
        measure_confidence IS NULL
        OR (measure_confidence >= 0 AND measure_confidence <= 1)
      );
  END IF;
END
$$;

COMMENT ON COLUMN listing.is_weighted IS
  'Feed bIsWeighted when known; NULL until backfill/ingest populates it.';
COMMENT ON COLUMN listing.sale_basis IS
  'How the SKU is sold: per_kg | per_l | per_piece | per_pack | unknown.';
COMMENT ON COLUMN listing.piece_count IS
  'Pieces per pack when sold by count (feed unit qty or name-inferred מארז/N יח).';
COMMENT ON COLUMN listing.measure_source IS
  'Provenance of pack/sale facts: feed | name_inferred | weighted_default | unknown.';
COMMENT ON COLUMN listing.measure_confidence IS
  '0–1 confidence in the pack/sale facts (higher overwrites lower on ingest).';
COMMENT ON COLUMN product.piece_count IS
  'Optional rollup of pieces-per-pack onto the shared product identity.';
COMMENT ON COLUMN product.pack_metadata_source IS
  'Provenance of product.piece_count (e.g. feed | name_inferred).';
