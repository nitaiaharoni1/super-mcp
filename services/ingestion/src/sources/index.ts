import type { SourceAdapter } from "@super-mcp/shared";
import {
  CERBERUS_CHAINS,
  createCerberusAdapter,
  type CerberusChainConfig,
} from "./cerberus/adapter.js";
import { createCarrefourAdapter } from "./carrefour/adapter.js";
import { createPublishPriceAdapter, PUBLISHPRICE_PORTALS } from "./publishprice/index.js";
import { createFixtureAdapter } from "./fixture/adapter.js";
import { createShufersalAdapter } from "./shufersal/adapter.js";

export {
  createCerberusAdapter,
  createShufersalAdapter,
  createCarrefourAdapter,
  createPublishPriceAdapter,
  createFixtureAdapter,
  PUBLISHPRICE_PORTALS,
};

/**
 * Restrict Cerberus to named chains (FTP usernames or chain ids).
 *
 * Chains are processed in list order and a big one can occupy a whole run, so
 * when a specific chain falls behind there is otherwise no way to catch it up
 * without re-ingesting everything ahead of it. Real case: six chains sat a week
 * stale while a full run spent hours on Rami Levy, the first entry, and would
 * have timed out before reaching them.
 *
 * Unknown names throw rather than silently narrowing the run to nothing, since
 * a typo that ingests zero chains and exits 0 is the failure this codebase has
 * already been bitten by once.
 */
export function selectCerberusChains(names: string[]): CerberusChainConfig[] {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return CERBERUS_CHAINS;
  const selected = CERBERUS_CHAINS.filter(
    (c) => wanted.includes(c.ftpUser.toLowerCase()) || wanted.includes(c.chainId),
  );
  const matched = new Set(
    selected.flatMap((c) => [c.ftpUser.toLowerCase(), c.chainId]),
  );
  const unknown = wanted.filter((w) => !matched.has(w));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown Cerberus chain(s): ${unknown.join(", ")}. Known: ${CERBERUS_CHAINS.map((c) => c.ftpUser).join(", ")}`,
    );
  }
  return selected;
}

export function getAdapters(selection: string, chains: string[] = []): SourceAdapter[] {
  switch (selection) {
    case "fixture":
      return [createFixtureAdapter()];
    case "il-cerberus":
      return [createCerberusAdapter(selectCerberusChains(chains))];
    case "il-shufersal":
      return [createShufersalAdapter()];
    case "il-carrefour":
      return [createCarrefourAdapter()];
    case "all":
      return [
        createShufersalAdapter(),
        createCerberusAdapter(selectCerberusChains(chains)),
        ...PUBLISHPRICE_PORTALS.map((p) => createPublishPriceAdapter(p)),
      ];
    default: {
      throw new Error(
        `Unknown source '${selection}'. Use fixture|il-cerberus|il-shufersal|il-carrefour|all`,
      );
    }
  }
}
