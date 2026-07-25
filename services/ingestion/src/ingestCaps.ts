/**
 * Store-count caps for PriceFull/PromoFull selection.
 *
 * - default: 2 stores (fast local smoke)
 * - SUPER_MCP_FULL=1: higher per-adapter caps, all Cerberus chains
 * - SUPER_MCP_NO_CAP=1: no store-count limit (region filter still applies)
 */

export function storeCountCap(fullCap: number): number {
  if (process.env.SUPER_MCP_NO_CAP === "1") return Number.MAX_SAFE_INTEGER;
  if (process.env.SUPER_MCP_FULL === "1") return fullCap;
  return 2;
}

export function allChainsEnabled(): boolean {
  return process.env.SUPER_MCP_FULL === "1" || process.env.SUPER_MCP_NO_CAP === "1";
}

/**
 * Whether this run is limited to the local-smoke subset.
 *
 * Exists because the caps are INVISIBLE in a run summary, which let a capped run
 * masquerade as a healthy national ingest for a week in production. The Cloud Run
 * job had neither flag set, so every night it refreshed 2 stores per chain for the
 * first 2 Cerberus chains: 8 of 898 stores, reported as `status: "success"` with
 * `rowsError: 0`. Nothing in the output said "capped", and the chain-coverage gate
 * could not catch it either, because `expectedChainIdsForSource` deliberately
 * mirrors what the adapter ATTEMPTS, so it shrank to match the degraded mode.
 *
 * Callers surface this in the run summary and warn on it, so a capped run against a
 * populated database is obvious rather than silent.
 */
export function coverageMode(): "full" | "capped_smoke" {
  return allChainsEnabled() ? "full" : "capped_smoke";
}

/** The store cap in force, or null when unlimited. Purely for reporting. */
export function activeStoreCap(): number | null {
  if (process.env.SUPER_MCP_NO_CAP === "1") return null;
  if (process.env.SUPER_MCP_FULL === "1") return null;
  return 2;
}
