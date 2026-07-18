-- get_promotions orders active promotions by soonest end date and pages with a
-- small LIMIT. Without a btree on end_ts the planner sorted the full ~1M-row
-- promotion table on every call (~12s). This index lets the ORDER BY end_ts ASC
-- LIMIT scan in index order and stop early (warm ~30ms). The (end_ts, id) shape
-- also matches the deterministic "ORDER BY end_ts, id" tie-break.
CREATE INDEX IF NOT EXISTS promotion_end_ts_idx ON promotion (end_ts, id);
