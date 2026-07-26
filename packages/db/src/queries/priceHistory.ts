/**
 * Whether ingestion appends to `price_point`.
 *
 * Off by default. The history exists only for `GET /v1/products/:id/history`,
 * which had been called exactly once in the service's lifetime (2026-07-16,
 * almost certainly a smoke test) against 2,209 `/mcp` calls.
 *
 * Writing it is not free. Cloud SQL disk throughput scales with disk size, and
 * on a 20GB PD_SSD the instance is capped near 600 write IOPS. Measured during a
 * full ingest: ~585 write ops/sec sustained, so the disk sat at roughly 97% of
 * quota while CPU idled at 48%. Every changed price added a second INSERT plus
 * its index maintenance to exactly the resource that was saturated.
 *
 * Reads keep working: the rows already written stay, and the endpoint still
 * serves them. Set SUPER_MCP_PRICE_HISTORY=1 to resume appending.
 */
export function priceHistoryEnabled(): boolean {
  return process.env.SUPER_MCP_PRICE_HISTORY === "1";
}
