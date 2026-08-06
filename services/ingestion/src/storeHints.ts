import type { FeedFile } from "@super-mcp/shared";
import { knownStoreLocationsForChain } from "@super-mcp/db";
import {
  isOrderableStorefront,
  onlineStoresOnly,
  toStoreLocationHintsFromDb,
  type StoreLocationHint,
} from "./regions.js";
import { selectRegionalFeedFiles } from "./selectRegionalFiles.js";
import { normalizeStoreCode } from "./storeCode.js";

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
  const selected = selectRegionalFeedFiles(files, hints, maxStores);

  if (onlineStoresOnly() && !selected.some((f) => f.kind === "pricesfull")) {
    nothingToPrice.add(chainId);
  } else {
    nothingToPrice.delete(chainId);
  }
  return selected;
}

/**
 * Chains this run selected no price file for.
 *
 * Module state because it is a fact about the current process: the ingest is a
 * one-shot CLI, discovery decides this, and the run summary needs it afterwards.
 * Threading it back would mean widening the `SourceAdapter` contract for every
 * adapter to carry a value only one filter produces.
 *
 * The run summary needs it because `classifyStatus` marks a run degraded when a
 * configured chain yields no price rows, and under the online filter that is now
 * the correct outcome for most of the chains we hold. Eight have no storefront
 * at all. Yohananof has three pickup points and publishes no PriceFull for any
 * of them, measured 2026-08-06. Reporting either nightly would turn the alarm
 * into noise inside a week.
 *
 * Keyed on "no file was selected" rather than "no storefront exists" because
 * that is the question the gate is really asking: a chain we DID download a
 * price file for and got no rows from is still a genuine failure, and still
 * reported. The case the old gate existed for, a chain's prices going quietly
 * stale, is now answered by freshness (`/ready` newestSourceTs and each store's
 * last_seen_at) rather than by a per-run file count, because a run cannot tell
 * a chain that published nothing today from one that has nothing to publish.
 */
const nothingToPrice = new Set<string>();

/** Chains exempt from "no price rows" because there was nothing to download. */
export function chainsWithNoStorefront(): string[] {
  return [...nothingToPrice];
}

/** Test-only: forget what earlier runs in this process discovered. */
export function _resetStorefrontlessChains(): void {
  nothingToPrice.clear();
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

  // Today's ids come straight from the XML; the DB's are normalized on write, so
  // a feed printing "39" against a stored "039" is the same store. Compare on the
  // normalized form or every healthy run reports a rescue that never happened.
  const byCode = new Map(locations.map((l) => [normalizeStoreCode(l.storeId), l]));
  const restored: StoreLocationHint[] = [];
  const rescued: StoreLocationHint[] = [];

  for (const k of known) {
    if (!isOrderableStorefront(k)) continue;
    const fromFeed = byCode.get(normalizeStoreCode(k.storeId));
    if (!fromFeed) {
      // Absent from today's Stores file entirely.
      restored.push(k);
      continue;
    }
    if (!isOrderableStorefront(fromFeed)) rescued.push(k);
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
