import type { SourceAdapter } from "@super-mcp/shared";
import {
  CERBERUS_CHAINS,
  createCerberusAdapter,
  type CerberusChainConfig,
} from "./cerberus/adapter.js";
import { createCarrefourAdapter } from "./carrefour/adapter.js";
import { createPublishPriceAdapter, PUBLISHPRICE_PORTALS } from "./publishprice/index.js";
import { createLaibcatalogAdapter } from "./laibcatalog/index.js";
import { createFixtureAdapter } from "./fixture/adapter.js";
import { createShufersalAdapter } from "./shufersal/adapter.js";

export {
  createCerberusAdapter,
  createShufersalAdapter,
  createCarrefourAdapter,
  createPublishPriceAdapter,
  createLaibcatalogAdapter,
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

/**
 * Sources this deployment cannot reach, from `SUPER_MCP_EXCLUDE_SOURCES`.
 *
 * `laibcatalog.co.il` silently drops TCP connects from outside Israel: the
 * europe-west1 ingest job fails on its first fetch with UND_ERR_CONNECT_TIMEOUT
 * while the same image in me-west1 (Tel Aviv) ingests it fine. So the national
 * job has to be able to leave that one source out, or it books a guaranteed
 * failure every single night, and an alert that always fires is an alert nobody
 * reads. Excluded by deployment rather than in code, because which sources a
 * region can reach is a property of where it runs, not of the source.
 */
function excludedSourceIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.SUPER_MCP_EXCLUDE_SOURCES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getAdapters(selection: string, chains: string[] = []): SourceAdapter[] {
  const excluded = excludedSourceIds();
  const keep = (adapters: SourceAdapter[]): SourceAdapter[] => {
    const kept = adapters.filter((a) => !excluded.has(a.sourceId.toLowerCase()));
    const dropped = adapters.length - kept.length;
    if (dropped > 0) {
      console.log(
        JSON.stringify({
          event: "ingestion_sources_excluded",
          excluded: [...excluded],
          remaining: kept.map((a) => a.sourceId),
        }),
      );
    }
    // Excluding every source is a misconfiguration, not a no-op run: refuse it
    // rather than exit 0 having ingested nothing.
    if (kept.length === 0 && adapters.length > 0) {
      throw new Error(
        `SUPER_MCP_EXCLUDE_SOURCES excluded every source for '${selection}': ${[...excluded].join(", ")}`,
      );
    }
    return kept;
  };
  switch (selection) {
    case "fixture":
      return [createFixtureAdapter()];
    case "il-cerberus":
      return [createCerberusAdapter(selectCerberusChains(chains))];
    case "il-shufersal":
      return [createShufersalAdapter()];
    case "il-carrefour":
      return [createCarrefourAdapter()];
    case "il-laibcatalog":
      return [createLaibcatalogAdapter()];
    case "all":
      return keep([
        createShufersalAdapter(),
        createCerberusAdapter(selectCerberusChains(chains)),
        ...PUBLISHPRICE_PORTALS.map((p) => createPublishPriceAdapter(p)),
        createLaibcatalogAdapter(),
      ]);
    default: {
      throw new Error(
        `Unknown source '${selection}'. Use fixture|il-cerberus|il-shufersal|il-carrefour|il-laibcatalog|all`,
      );
    }
  }
}
