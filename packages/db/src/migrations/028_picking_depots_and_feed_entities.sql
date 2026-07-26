-- Two store-data repairs behind one live complaint: a shopper at Mendelson 1,
-- Tel Aviv was told to drive to "ליקוט רמת החייל, 0.61 km".
--
-- 1. ORDER-PICKING DEPOTS ARE NOT SHOPS
--
-- "ליקוט" is order picking: a dark store where staff assemble web orders. Tiv
-- Taam files seven, each shadowing a real branch of the same name, none with an
-- address or coordinates, and between 58 and 17,818 prices each:
--
--   ליקוט רמת החייל   16,119 prices   (beside the real רמת החייל, דבורה הנביאה 122)
--   ליקוט ראשון מזרח  17,818 prices
--   ליקוט נתניה       15,070 prices
--
-- They were classified 'branch', so the basket recommended one as the shopper's
-- first stop. classifyStoreKind() in @super-mcp/shared gained the same rule;
-- this brings already-migrated databases into line with it.
--
-- The pattern requires ליקוט to be a whole word, so it cannot fire on a name
-- that merely starts with those letters ("ליקוטי"). Only 'branch' rows are
-- touched: anything 023/024 already identified keeps its more specific kind.

UPDATE store
SET store_kind = 'online',
    updated_at = now()
WHERE store_kind = 'branch'
  AND name ~ 'ליקוט([^א-ת]|$)';

-- 2. FEED ESCAPING MADE ADDRESSES UNGEOCODABLE
--
-- Some chains double-escape, so the XML parser yields a literal "&#x0D;" rather
-- than a carriage return. Rami Levy Ramat HaHayal filed its address as
-- "דבורה הנביאה 127&#x0D;", which no geocoder resolves — so the branch fell back
-- to the Tel Aviv centroid and reported the distance to the middle of town,
-- while the Tiv Taam store on the SAME street (דבורה הנביאה 122) geocoded fine.
--
-- Four rows carry this, three of them still stuck at city precision.
-- scrubOptionalText() now decodes at ingest; this repairs what is already
-- stored.
--
-- Only the address is touched. `upgradeStoreAddresses` already re-examines every
-- row whose geo_source is NULL *or* 'city_centroid', so a clean address is
-- enough for the next pass to upgrade it — and clearing the coordinates to
-- "force" that retry would be strictly worse: a row the geocoder then fails to
-- resolve (OSM cannot find "משה פלימן 4", Haifa) would be left with no position
-- at all, which ranks it at the 50 km unknown-distance charge and drops it out
-- of recommendations entirely. A coarse centroid beats no location.

UPDATE store
SET address = btrim(regexp_replace(
      regexp_replace(address, '&#[xX]0*[dDaA];|&#0*(9|10|13);', ' ', 'g'),
      '\s+', ' ', 'g')),
    updated_at = now()
WHERE address ~ '&#[xX]0*[dDaA];|&#0*(9|10|13);';
