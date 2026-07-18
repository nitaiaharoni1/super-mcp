-- Feeds don't carry coordinates, so every store.lat/lng is currently backfilled
-- by geocodeStores.ts (city centroid now, address-level later). Record HOW each
-- point was derived so a later, more precise pass (address, or a real feed
-- coordinate) can safely overwrite a coarser city-centroid guess and so the API
-- can weight `near=` matches by precision.
--   'feed'          -> coordinate came straight from the source feed
--   'address'       -> geocoded from the store's full street address
--   'city_centroid' -> coarse fallback: the store's city centroid
ALTER TABLE store ADD COLUMN IF NOT EXISTS geo_source text;

COMMENT ON COLUMN store.geo_source IS
  'Provenance of store.lat/lng: feed | address | city_centroid (NULL when ungeocoded).';
