/**
 * Which chains a source is expected to yield data for on this run.
 *
 * `SourceAdapter` (in @super-mcp/shared) has no way to declare its chains, so
 * the expectation lives here. It exists so a configured chain that quietly
 * produces nothing cannot be reported as a healthy `success` run: HaziHinam's
 * FTP account authenticates but publishes zero files, and because the other
 * eight Cerberus chains supplied plenty of data the run looked fine.
 *
 * The expectation deliberately mirrors what the adapter actually ATTEMPTS, so
 * the default 2-chain local smoke run is not permanently degraded.
 */
import { CERBERUS_CHAINS } from "./sources/cerberus/adapter.js";
import { allChainsEnabled } from "./ingestCaps.js";

/**
 * Chain ids this source should produce files for, or an empty array when the
 * source has no fixed expectation (single-chain adapters, fixtures, portals —
 * for those, zero files is already caught by the existing `empty` status).
 */
export function expectedChainIdsForSource(sourceId: string): string[] {
  if (sourceId !== "il-cerberus") return [];
  const attempted = allChainsEnabled() ? CERBERUS_CHAINS : CERBERUS_CHAINS.slice(0, 2);
  return attempted.map((chain) => chain.chainId);
}
