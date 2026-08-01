-- Some published fees are a floor, not the fee.
--
-- Wolt exposes `delivery_base_price` — the charge at zero distance — and computes
-- the real figure at checkout from the courier route. ₪10 is therefore what a
-- shopper pays at best and never what they pay at worst.
--
-- Stored as an ordinary flat band it reads as a verified ₪10 delivery, which is a
-- confidently understated total: exactly the failure the confidence/verified_at
-- machinery exists to prevent, arriving through the one door that machinery does
-- not cover. Marking the band lets the API report `deliveryFeeIsFloor` and callers
-- say "from ₪10" instead of "₪10".

ALTER TABLE delivery_tariff ADD COLUMN IF NOT EXISTS fee_is_floor boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN delivery_tariff.fee_is_floor IS
  'True when fee is a published lower bound rather than the charge (e.g. Wolt''s zero-distance base price). Callers must present it as "from X", and any total built on it is a lower bound too.';
