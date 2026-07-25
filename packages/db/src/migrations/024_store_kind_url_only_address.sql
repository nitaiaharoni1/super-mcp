-- store_kind parity: e-commerce endpoints whose only address is a URL.
--
-- 023 classified store_kind from name+address keywords. That misses chains which
-- file an online storefront with no locality at all and the shop URL in place of
-- a street. Live examples that stayed 'branch' with thousands of prices each:
--
--   קרפור 472  "@ יהלומים ביתן (9032)"  https://www.ybitan.co.il   (2,682 prices)
--   קרפור 473  "כפר סבא @ קוויק"        https://www.quik.co.il     (4,799 prices)
--
-- Neither is a shop a person walks into, yet both were recommendable as "your
-- store". classifyStoreKind() in @super-mcp/shared gained the same rule; this
-- brings already-migrated databases into line with it.
--
-- The test is "the address is ONLY a URL", never "contains a URL". קשת 103
-- (קולינריק חורב) has address 'חורב 15 | www.kulinarik.co.il/|' and IS a real
-- branch — a contains-check would wrongly delist it. Hence the anchored pattern
-- below, which requires every separator-delimited token to be a web address.
--
-- Only 'branch' rows are touched: a row already identified as warehouse/pickup/
-- online by 023 keeps its more specific kind.

UPDATE store
SET store_kind = 'online',
    updated_at = now()
WHERE store_kind = 'branch'
  AND address IS NOT NULL
  AND btrim(address) <> ''
  AND btrim(address) ~* '^[\s|,;]*((https?://)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(/[^\s|,;]*)?[\s|,;]*)+$';
