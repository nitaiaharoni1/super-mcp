-- The nightly privacy sweeps filter and sort on columns nothing indexed.
--
-- purgeOldUsageEvents and purgeIdleQueryEmbeddings both run
-- "WHERE <ts> < now() - interval ORDER BY <ts> LIMIT n". Before this migration the
-- planner answered both with a Seq Scan feeding a Sort (verified with EXPLAIN against
-- production): usage_event's only usable index is (api_key_id, created_at DESC), whose
-- leading column the sweep does not filter on, and semantic_query_embedding had nothing
-- on embedded_at at all.
--
-- That matters more than a slow query, because of how deleteInBatches recovers. On a
-- statement timeout it retries with batchSize/4, which only helps if cost scales with the
-- LIMIT. Under a Seq Scan + Sort the cost scales with TABLE SIZE instead, so a shrinking
-- batch never gets cheaper: the sweep would time out at every size, throw at the floor,
-- and be swallowed by the non-fatal catch in the ingest job. The result is a sweep that
-- fails silently every night on exactly the table it exists to prune -- and usage_event is
-- the one table here that grows per request, without bound.
--
-- This is the same fix, for the same reason, as 015_promotion_end_ts_index.sql.
--
-- Harmless to apply now: both tables are small and nothing is old enough to delete yet.
-- The point is to land it before usage_event is large enough for the failure to appear.

-- (created_at, id) rather than (created_at): the sweep's CTE selects only id, so this
-- shape lets it run as an index-only scan and stop at the LIMIT.
CREATE INDEX IF NOT EXISTS usage_event_created_at_idx ON usage_event (created_at, id);

-- The cache table is small and self-limiting, so a plain range scan on the sweep column
-- is enough; no need to widen this to cover query_hash/model.
CREATE INDEX IF NOT EXISTS semantic_query_embedding_embedded_at_idx
  ON semantic_query_embedding (embedded_at);
