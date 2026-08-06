import type { FeedFile } from "@super-mcp/shared";
import { knownStoreLocationsForChain } from "@super-mcp/db";
import {
  isOrderableStorefront,
  onlineStoresOnly,
  toStoreLocationHintsFromDb,
  type StoreLocationHint,
} from "./regions.js";
import { selectRegionalFeedFiles } from "./selectRegionalFiles.js";

/**
 * Pick this chain's price files, with the database as a safety net.
 *
 * The online filter decides what to download from the chain's own Stores file,
 * which is the right source and an unreliable one. A single field going missing
 * for a night is the difference between ingesting a chain and ingesting nothing
 * from it, and the shape of that failure is silent: zero orderable storefronts
 * looks exactly like a chain that does not deliver, and eight of the sixteen
 * chains we hold genuinely do not.
 *
 * Rami Levy is the worked example. Its online store is called "מרלוג אינטרנט",
 * which reads as a distribution centre and classifies as one on the name alone.
 * It survives only because the feed declares StoreType 2. Lose that field and we
 * lose the chain's entire delivery catalogue, quietly, until someone notices.
 *
 * So a storefront we have already established as orderable stays orderable: the
 * store row carries the kind decided on the day the feed was healthy. The feed
 * can add storefronts and it can move them, but it cannot silently retract one.
 */
export async function selectFeedFilesForChain(
  chainId: string,
  files: FeedFile[],
  locations: StoreLocationHint[],
  maxStores: number,
): Promise<FeedFile[]> {
  const hints = await withKnownOrderable(chainId, locations);
  if (onlineStoresOnly() && !hints.some(isOrderableStorefront)) {
    storefrontlessChains.add(chainId);
  } else {
    storefrontlessChains.delete(chainId);
  }
  return selectRegionalFeedFiles(files, hints, maxStores);
}

/**
 * Chains this run found no orderable storefront for.
 *
 * Module state because it is a fact about the current process: the ingest is a
 * one-shot CLI, discovery decides this, and the run summary needs it afterwards.
 * Threading it back would mean widening the `SourceAdapter` contract for every
 * adapter to carry a value only one filter produces.
 *
 * The run summary needs it because "this chain produced no price rows" is an
 * alarm worth keeping and, for eight of our sixteen chains, now the correct
 * outcome. Without this the nightly run would report `degraded` every night on a
 * healthy ingest, and the alarm that caught Osher Ad's prices going a fortnight
 * stale would be noise inside a week.
 */
const storefrontlessChains = new Set<string>();

/** Chains exempt from "no price rows" because they have nowhere to order from. */
export function chainsWithNoStorefront(): string[] {
  return [...storefrontlessChains];
}

/** Test-only: forget what earlier runs in this process discovered. */
export function _resetStorefrontlessChains(): void {
  storefrontlessChains.clear();
}

async function withKnownOrderable(
  chainId: string,
  locations: StoreLocationHint[],
): Promise<StoreLocationHint[]> {
  if (!onlineStoresOnly()) return locations;

  let known: StoreLocationHint[];
  try {
    known = toStoreLocationHintsFromDb(await knownStoreLocationsForChain(chainId));
  } catch (err) {
    // A safety net that throws is worse than none: fall through to the feed's
    // own answer rather than fail the chain.
    console.error(
      JSON.stringify({
        severity: "WARNING",
        event: "ingestion_orderable_backstop_unavailable",
        chainId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return locations;
  }

  const seen = new Set(locations.map((l) => l.storeId));
  const restored: StoreLocationHint[] = [];
  const rescued: StoreLocationHint[] = [];

  for (const k of known) {
    if (!isOrderableStorefront(k)) continue;
    if (!seen.has(k.storeId)) {
      // Absent from today's Stores file entirely.
      restored.push(k);
      continue;
    }
    const fromFeed = locations.find((l) => l.storeId === k.storeId);
    if (fromFeed && !isOrderableStorefront(fromFeed)) rescued.push(k);
  }

  if (restored.length === 0 && rescued.length === 0) return locations;

  console.log(
    JSON.stringify({
      event: "ingestion_orderable_backstop_applied",
      chainId,
      // Known orderable, missing from today's Stores file.
      restoredFromDb: restored.map((s) => s.storeId),
      // Present today, but today's record no longer reads as orderable.
      reclassifiedByDb: rescued.map((s) => s.storeId),
    }),
  );

  const rescuedIds = new Set(rescued.map((s) => s.storeId));
  return [...locations.filter((l) => !rescuedIds.has(l.storeId)), ...rescued, ...restored];
}
