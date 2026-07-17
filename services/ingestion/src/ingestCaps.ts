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
